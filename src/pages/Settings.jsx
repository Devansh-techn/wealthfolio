import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Monitor, Moon, Sun, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useAppData } from '../contexts/DataContext';
import { useCurrency } from '../contexts/CurrencyContext';
import { useToast } from '../contexts/ToastContext';
import { PageHeader } from '../components/ui/Feedback';
import Modal from '../components/ui/Modal';
import { CheckField, SelectField, TextField } from '../components/ui/Form';
import { invokeFunction } from '../services/functions';
import { CURRENCIES } from '../lib/constants';
import { collectErrors, friendlyError, validatePassword } from '../lib/validation';
import { formatDate, formatRelativeTime } from '../lib/format';

const THEMES = [['dark', 'Dark', Moon], ['light', 'Light', Sun], ['system', 'System', Monitor]];

export default function Settings() {
  const { user, signOut, updatePassword } = useAuth();
  const data = useAppData();
  const { currency, setCurrency, fx, fxStatus } = useCurrency();
  const toast = useToast();
  const navigate = useNavigate();
  const p = data.profile;
  const [pw, setPw] = useState({ password: '', confirm: '' });
  const [pwErr, setPwErr] = useState({});
  const [pwBusy, setPwBusy] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState('');

  const update = async (patch, ok) => {
    try {
      await data.updateProfile(patch);
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(friendlyError(e, 'Could not save the setting.'));
    }
  };
  const changePw = async (e) => {
    e.preventDefault();
    const errs = collectErrors({ password: validatePassword(pw.password), confirm: pw.confirm === pw.password ? null : 'Passwords do not match.' });
    setPwErr(errs);
    if (Object.keys(errs).length) return;
    setPwBusy(true);
    try {
      await updatePassword(pw.password);
      setPw({ password: '', confirm: '' });
      toast.success('Password updated.');
    } catch (err) {
      setPwErr({ password: friendlyError(err, 'Could not update your password.') });
    } finally {
      setPwBusy(false);
    }
  };
  const logout = async () => {
    await signOut();
    navigate('/', { replace: true });
  };
  const deleteAccount = async () => {
    setDelBusy(true);
    setDelErr('');
    try {
      await invokeFunction('delete-account', { confirm: 'DELETE' });
      await signOut();
      navigate('/', { replace: true });
    } catch (e) {
      setDelErr(friendlyError(e, 'Could not delete the account.'));
      setDelBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Settings" subtitle="Appearance, notifications and account" />

      <section className="panel glass-panel" aria-labelledby="ap-h">
        <h2 id="ap-h" className="panel-title">Appearance &amp; currency</h2>
        <fieldset className="theme-picker">
          <legend>Theme</legend>
          {THEMES.map(([v, label, Icon]) => (
            <label key={v} className={`theme-opt ${p.theme === v ? 'on' : ''}`}>
              <input type="radio" name="theme" value={v} checked={p.theme === v} onChange={() => update({ theme: v })} />
              <Icon size={16} aria-hidden="true" /> {label}
            </label>
          ))}
        </fieldset>
        <div className="form-grid">
          <SelectField label="Display currency" value={currency} onChange={async (e) => { try { await setCurrency(e.target.value); toast.success('Currency saved.'); } catch (err) { toast.error(friendlyError(err)); } }} options={CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} — ${c.label}` }))} hint="Assets keep their native currency; this only changes how totals are shown." />
          <div className="field"><label>Exchange rates</label><p className="field-hint static">{fxStatus === 'ready' && fx ? `European Central Bank reference rates, ${formatDate(fx.asOf)}` : fxStatus === 'loading' ? 'Loading…' : 'Unavailable'}</p></div>
        </div>
      </section>

      <section className="panel glass-panel" aria-labelledby="no-h">
        <h2 id="no-h" className="panel-title">Notifications</h2>
        <CheckField label="Budget alerts" checked={p.notifications_enabled} onChange={(e) => update({ notifications_enabled: e.target.checked }, e.target.checked ? 'Alerts on.' : 'Alerts off.')} hint="Get an in-app notification when a monthly budget reaches 80% or is exceeded." />
      </section>

      <section className="panel glass-panel" aria-labelledby="ac-h">
        <h2 id="ac-h" className="panel-title">Account</h2>
        <dl className="kv">
          <dt>Email</dt><dd>{user.email}</dd>
          <dt>Member since</dt><dd>{formatDate(p.created_at)}</dd>
          <dt>Last sign-in</dt><dd>{formatRelativeTime(user.last_sign_in_at)}</dd>
        </dl>
        <form onSubmit={changePw} noValidate className="form-grid pw-form">
          <TextField label="New password" type="password" autoComplete="new-password" value={pw.password} onChange={(e) => setPw((x) => ({ ...x, password: e.target.value }))} error={pwErr.password} hint="8+ characters with a letter and a number." />
          <TextField label="Confirm new password" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw((x) => ({ ...x, confirm: e.target.value }))} error={pwErr.confirm} />
          <div className="span-2"><button type="submit" className="btn-secondary" disabled={pwBusy}>{pwBusy ? 'Updating…' : 'Change password'}</button></div>
        </form>
        <div className="btn-row"><button type="button" className="btn-secondary" onClick={logout}><LogOut size={16} aria-hidden="true" /> Sign out</button></div>
      </section>

      <section className="panel glass-panel danger-zone" aria-labelledby="dz-h">
        <h2 id="dz-h" className="panel-title">Danger zone</h2>
        <p className="text-body">Permanently delete your account and every portfolio, transaction, goal and budget. This can’t be undone.</p>
        <button type="button" className="btn-danger" onClick={() => setDelOpen(true)}><Trash2 size={16} aria-hidden="true" /> Delete my account</button>
      </section>

      <Modal open={delOpen} onClose={delBusy ? () => {} : () => setDelOpen(false)} title="Delete account?" size="sm"
        footer={<><button type="button" className="btn-ghost" onClick={() => setDelOpen(false)} disabled={delBusy}>Cancel</button><button type="button" className="btn-danger" onClick={deleteAccount} disabled={delBusy || confirmText !== 'DELETE'}>{delBusy ? 'Deleting…' : 'Delete everything'}</button></>}>
        <p className="text-body">Type <strong>DELETE</strong> to confirm.</p>
        <TextField label="Confirmation" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" data-autofocus />
        {delErr && <p className="form-error" role="alert">{delErr}</p>}
      </Modal>
    </>
  );
}
