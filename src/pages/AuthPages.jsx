import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Loader2, MailCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { detectCurrency } from '../lib/locale';
import { useToast } from '../contexts/ToastContext';
import { PasswordField, TextField } from '../components/ui/Form';
import { PageLoader, InlineNotice } from '../components/ui/Feedback';
import { collectErrors, friendlyError, isEmail, required, validatePassword } from '../lib/validation';
import { SESSION_FLAG } from '../lib/constants';
import SetupRequired from './SetupRequired';

function AuthShell({ title, subtitle, children, footer }) {
  return (
    <main className="auth-page" id="main">
      <div className="auth-card glass-panel">
        <Link to="/" className="auth-brand" aria-label="WealthFolio home">
          <img src="/favicon.svg" alt="" width="34" height="34" />
          <span className="auth-logo text-gradient">WealthFolio.</span>
        </Link>
        <h1 className="auth-title">{title}</h1>
        {subtitle && <p className="text-body auth-sub">{subtitle}</p>}
        {children}
        {footer && <p className="auth-footer">{footer}</p>}
      </div>
    </main>
  );
}

/** Primary form action: full width, gradient, with a spinner while busy. */
function SubmitButton({ busy, busyLabel, children }) {
  return (
    <button type="submit" className="btn-primary btn-block" disabled={busy} aria-busy={busy || undefined}>
      {busy && <Loader2 size={18} className="spin" aria-hidden="true" />}
      {busy ? busyLabel : children}
    </button>
  );
}

function GoogleButton({ onClick, busy }) {
  return (
    <button type="button" className="btn-google" onClick={onClick} disabled={busy}>
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z" />
        <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
        <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
      </svg>
      Continue with Google
    </button>
  );
}

export function LoginPage() {
  const { signIn, signInWithGoogle, configured } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [expired] = useState(() => {
    try {
      const v = sessionStorage.getItem(SESSION_FLAG) === '1';
      sessionStorage.removeItem(SESSION_FLAG);
      return v;
    } catch {
      return false;
    }
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (!configured) return <SetupRequired />;

  const submit = async (e) => {
    e.preventDefault();
    const errs = collectErrors({ email: isEmail(form.email) ? null : 'Enter a valid email address.', password: required(form.password, 'Password') });
    setErrors(errs);
    setFormError('');
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await signIn(form);
      navigate(location.state?.from ?? '/dashboard', { replace: true });
    } catch (err) {
      setFormError(friendlyError(err, 'Unable to sign in. Please try again.'));
    } finally {
      setBusy(false);
    }
  };
  const google = async () => {
    try {
      await signInWithGoogle();
    } catch (err) {
      toast.error(friendlyError(err, 'Google sign-in is not available.'));
    }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to continue to your WealthFolio account." footer={<>Don't have an account? <Link to="/signup">Sign up</Link></>}>
      {expired && <InlineNotice tone="warn">Session expired. Please sign in again.</InlineNotice>}
      <form onSubmit={submit} noValidate className="form-stack">
        <TextField label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} required />
        <PasswordField label="Password" autoComplete="current-password" value={form.password} onChange={set('password')} error={errors.password} required />
        <Link to="/forgot-password" className="link-sm">Forgot password?</Link>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <SubmitButton busy={busy} busyLabel="Signing in…">Sign in</SubmitButton>
      </form>
      <div className="divider"><span>or</span></div>
      <GoogleButton onClick={google} busy={busy} />
    </AuthShell>
  );
}

export function SignupPage() {
  const { signUp, signInWithGoogle, resendVerification, configured } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [sent, setSent] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (!configured) return <SetupRequired />;

  const submit = async (e) => {
    e.preventDefault();
    const errs = collectErrors({
      fullName: required(form.fullName, 'Full name'),
      email: isEmail(form.email) ? null : 'Enter a valid email address.',
      password: validatePassword(form.password),
      confirm: form.confirm === form.password ? null : 'Passwords do not match.',
    });
    setErrors(errs);
    setFormError('');
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const r = await signUp({ email: form.email, password: form.password, fullName: form.fullName.trim(), currency: detectCurrency() });
      if (r.needsVerification) setSent(true);
    } catch (err) {
      setFormError(friendlyError(err, 'Unable to create your account.'));
    } finally {
      setBusy(false);
    }
  };
  const resend = async () => {
    try {
      await resendVerification(form.email);
      toast.success('Verification email sent.');
    } catch (err) {
      toast.error(friendlyError(err, 'Could not resend the email.'));
    }
  };
  const google = async () => {
    try {
      await signInWithGoogle();
    } catch (err) {
      toast.error(friendlyError(err, 'Google sign-in is not available.'));
    }
  };

  if (sent) {
    return (
      <AuthShell title="Check your email" footer={<Link to="/login">Back to sign in</Link>}>
        <div className="auth-center"><MailCheck size={40} aria-hidden="true" /></div>
        <p className="text-body">If this address can be registered, we've sent a verification link to <strong>{form.email}</strong>. Open it to activate your account, then sign in.</p>
        <button type="button" className="btn-secondary btn-block" onClick={resend}>Resend verification email</button>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Create your account" subtitle="Start tracking your wealth in minutes." footer={<>Already have an account? <Link to="/login">Sign in</Link></>}>
      <form onSubmit={submit} noValidate className="form-stack">
        <TextField label="Full name" autoComplete="name" value={form.fullName} onChange={set('fullName')} error={errors.fullName} maxLength={120} required />
        <TextField label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} required />
        <PasswordField label="Password" autoComplete="new-password" value={form.password} onChange={set('password')} error={errors.password} hint="8+ characters with a letter and a number." required />
        <PasswordField label="Confirm password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} required />
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <SubmitButton busy={busy} busyLabel="Creating account…">Create account</SubmitButton>
      </form>
      <div className="divider"><span>or</span></div>
      <GoogleButton onClick={google} busy={busy} />
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const { resetPassword, configured } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  if (!configured) return <SetupRequired />;
  const submit = async (e) => {
    e.preventDefault();
    if (!isEmail(email)) return setError('Enter a valid email address.');
    setError('');
    setBusy(true);
    try {
      await resetPassword(email);
      setSent(true);
    } catch (err) {
      setError(friendlyError(err, 'Could not send the reset email.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a link to choose a new password." footer={<Link to="/login">Back to sign in</Link>}>
      {sent ? (
        <InlineNotice tone="ok">If an account exists for {email}, a reset link is on its way.</InlineNotice>
      ) : (
        <form onSubmit={submit} noValidate className="form-stack">
          <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={error} required />
          <SubmitButton busy={busy} busyLabel="Sending…">Send reset link</SubmitButton>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const { session, loading, updatePassword, configured } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  if (!configured) return <SetupRequired />;
  if (loading) return <PageLoader />;
  if (!session) {
    return (
      <AuthShell title="Link invalid or expired" footer={<Link to="/forgot-password">Request a new link</Link>}>
        <p className="text-body">This password reset link is no longer valid. Please request a new one.</p>
      </AuthShell>
    );
  }
  const submit = async (e) => {
    e.preventDefault();
    const errs = collectErrors({ password: validatePassword(form.password), confirm: form.confirm === form.password ? null : 'Passwords do not match.' });
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await updatePassword(form.password);
      toast.success('Password updated.');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setFormError(friendlyError(err, 'Could not update your password.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={submit} noValidate className="form-stack">
        <PasswordField label="New password" autoComplete="new-password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} error={errors.password} hint="8+ characters with a letter and a number." required />
        <PasswordField label="Confirm password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))} error={errors.confirm} required />
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <SubmitButton busy={busy} busyLabel="Saving…">Update password</SubmitButton>
      </form>
    </AuthShell>
  );
}

/** Landing target for email-verification links and OAuth redirects. */
export function AuthCallbackPage() {
  const { session, loading } = useAuth();
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, []);
  const params = new URLSearchParams(window.location.search + window.location.hash.replace('#', '&'));
  const err = params.get('error_description');
  if (session) return <Navigate to="/dashboard" replace />;
  if (err || (!loading && timedOut)) {
    return (
      <AuthShell title="We couldn't sign you in" footer={<Link to="/login">Go to sign in</Link>}>
        <p className="form-error" role="alert">{err ? err.replace(/\+/g, ' ') : 'The link is invalid or has expired.'}</p>
      </AuthShell>
    );
  }
  return <PageLoader label="Verifying…" />;
}
