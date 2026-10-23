import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useAppData } from '../contexts/DataContext';
import { useCurrency } from '../contexts/CurrencyContext';
import { useToast } from '../contexts/ToastContext';
import { PageHeader } from '../components/ui/Feedback';
import { SelectField, TextField } from '../components/ui/Form';
import { uploadAvatar } from '../services/dataService';
import { CURRENCIES, RISK_PREFERENCES } from '../lib/constants';
import { cleanText, friendlyError, required } from '../lib/validation';
import { formatDate } from '../lib/format';

export default function Profile() {
  const { user } = useAuth();
  const data = useAppData();
  const { setCurrency } = useCurrency();
  const toast = useToast();
  const p = data.profile;
  const [name, setName] = useState(p.full_name ?? '');
  const [risk, setRisk] = useState(p.risk_preference);
  const [cur, setCur] = useState(p.preferred_currency);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const save = async (e) => {
    e.preventDefault();
    const err = required(name, 'Full name');
    if (err) return setError(err);
    setBusy(true);
    setError('');
    try {
      await data.updateProfile({ full_name: cleanText(name, 120), risk_preference: risk, preferred_currency: cur });
      await setCurrency(cur);
      toast.success('Profile saved.');
    } catch (e2) {
      setError(friendlyError(e2, 'Could not save your profile.'));
    } finally {
      setBusy(false);
    }
  };
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadAvatar(p.id, file);
      await data.updateProfile({ avatar_url: url });
      toast.success('Photo updated.');
    } catch (e2) {
      toast.error(friendlyError(e2, e2?.message || 'Could not upload the photo.'));
    } finally {
      setUploading(false);
    }
  };
  const initial = (p.full_name || user.email).slice(0, 1).toUpperCase();

  return (
    <>
      <PageHeader title="Profile" subtitle="Your personal details and preferences" />
      <section className="panel glass-panel profile-card">
        <div className="profile-avatar">
          <div className="avatar avatar-lg">{p.avatar_url ? <img src={p.avatar_url} alt={`${p.full_name ?? 'Your'} profile`} /> : <span>{initial}</span>}</div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" id="avatar-file" onChange={onFile} />
          <button type="button" className="btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}><Camera size={14} aria-hidden="true" /> {uploading ? 'Uploading…' : 'Change photo'}</button>
          <small className="text-body">JPG, PNG or WebP, up to 2 MB</small>
        </div>
        <form onSubmit={save} noValidate className="form-grid grow">
          <TextField label="Full name" value={name} onChange={(e) => setName(e.target.value)} error={error} maxLength={120} required />
          <TextField label="Email" value={p.email ?? user.email} readOnly hint="Managed by your sign-in." />
          <SelectField label="Preferred currency" value={cur} onChange={(e) => setCur(e.target.value)} options={CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} — ${c.label}` }))} />
          <SelectField label="Risk preference" value={risk} onChange={(e) => setRisk(e.target.value)} options={RISK_PREFERENCES.map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) }))} hint="Informational — shown on your profile." />
          <TextField label="Member since" value={formatDate(p.created_at)} readOnly />
          <div className="span-2"><button type="submit" className="btn-primary-sm" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></div>
        </form>
      </section>
    </>
  );
}
