// @vitest-environment jsdom
// Behaviour of the redesigned auth screens: the UI changed, the logic must not have.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({ auth: null, toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => h.toast }));

import { LoginPage, SignupPage, ForgotPasswordPage } from '../pages/AuthPages';

const mkAuth = (over = {}) => ({ configured: true, session: null, loading: false, signIn: vi.fn(async () => {}), signUp: vi.fn(async () => ({ needsVerification: true })), signInWithGoogle: vi.fn(async () => {}),
  resendVerification: vi.fn(async () => {}), resetPassword: vi.fn(async () => {}), updatePassword: vi.fn(), ...over });
const view = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => { cleanup(); h.auth = mkAuth(); Object.values(h.toast).forEach((f) => f.mockClear()); });

describe('LoginPage', () => {
  it('renders the shell, labelled fields, forgot-password and signup links, divider and Google button', () => {
    view(<LoginPage />);
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy();
    expect(screen.getByLabelText(/^Email/)).toBeTruthy(); expect(screen.getByLabelText(/^Password/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Forgot password?' }).getAttribute('href')).toBe('/forgot-password');
    expect(screen.getByRole('link', { name: 'Sign up' }).getAttribute('href')).toBe('/signup');
    expect(screen.getByRole('link', { name: 'WealthFolio home' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeTruthy();
    expect(document.querySelector('.divider').textContent).toBe('or');
    expect(screen.getByRole('button', { name: 'Sign in' }).getAttribute('type')).toBe('submit');
  });

  it('validates before calling Supabase, then signs in with the entered credentials', async () => {
    view(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(h.auth.signIn).not.toHaveBeenCalled();
    type(/^Email/, 'me@example.com'); type(/^Password/, 'hunter22!');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(h.auth.signIn).toHaveBeenCalledWith({ email: 'me@example.com', password: 'hunter22!' }));
  });

  it('shows (never hides) an authentication error in an alert, and shows a busy state while signing in', async () => {
    let reject; h.auth.signIn = vi.fn(() => new Promise((_, r) => { reject = r; }));
    view(<LoginPage />);
    type(/^Email/, 'me@example.com'); type(/^Password/, 'wrong-pass1');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const busy = await screen.findByRole('button', { name: /signing in/i });
    expect(busy.disabled).toBe(true); expect(busy.querySelector('svg.spin')).toBeTruthy(); expect(screen.getByRole('button', { name: /continue with google/i }).disabled).toBe(true);
    reject(Object.assign(new Error('Invalid login credentials'), { status: 400 }));
    const alert = await screen.findByRole('alert'); expect(alert.textContent).toMatch(/incorrect email or password/i);
    expect(screen.getByRole('button', { name: 'Sign in' }).disabled).toBe(false);
  });

  it('starts the existing Google flow, and reports failures through the toast', async () => {
    view(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    await waitFor(() => expect(h.auth.signInWithGoogle).toHaveBeenCalledTimes(1));
    h.auth.signInWithGoogle.mockImplementationOnce(async () => { throw new Error('provider disabled'); });
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalled());
  });

  it('falls back to the setup screen when Supabase is not configured', () => {
    h.auth = mkAuth({ configured: false });
    view(<LoginPage />);
    expect(screen.getByText(/backend setup required/i)).toBeTruthy();
  });
});

describe('password visibility', () => {
  it('toggles the field type and exposes state to assistive tech, without touching the value', () => {
    view(<LoginPage />);
    const input = screen.getByLabelText(/^Password/);
    type(/^Password/, 's3cretPass');
    expect(input.getAttribute('type')).toBe('password');
    const btn = screen.getByRole('button', { name: 'Show password' });
    expect(btn.getAttribute('aria-pressed')).toBe('false'); expect(btn.getAttribute('type')).toBe('button');   // never submits the form
    fireEvent.click(btn);
    expect(input.getAttribute('type')).toBe('text'); expect(input.value).toBe('s3cretPass');
    expect(screen.getByRole('button', { name: 'Hide password' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input.getAttribute('type')).toBe('password');
  });
});

describe('SignupPage', () => {
  const fill = (over = {}) => {
    const v = { 'Full name': 'Dev Test', Email: 'dev@example.com', Password: 'Passw0rdOK', 'Confirm password': 'Passw0rdOK', ...over };
    type(/^Full name/, v['Full name']); type(/^Email/, v.Email); type(/^Password/, v.Password); type(/^Confirm password/, v['Confirm password']);
  };
  it('keeps every field, the hint and the validation rules (including confirm-password)', async () => {
    view(<SignupPage />);
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeTruthy();
    expect(screen.getByText('Start tracking your wealth in minutes.')).toBeTruthy();
    expect(screen.getByText('8+ characters with a letter and a number.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Full name is required.')).toBeTruthy();
    fill({ Password: 'short1', 'Confirm password': 'short1' });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Use at least 8 characters.')).toBeTruthy();
    fill({ 'Confirm password': 'Different1' });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Passwords do not match.')).toBeTruthy();
    expect(h.auth.signUp).not.toHaveBeenCalled();
  });
  it('submits trimmed details and then shows the check-your-email success state with resend', async () => {
    view(<SignupPage />);
    fill({ 'Full name': '  Dev Test  ' });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(h.auth.signUp).toHaveBeenCalledWith(expect.objectContaining({ email: 'dev@example.com', password: 'Passw0rdOK', fullName: 'Dev Test' })));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /resend verification/i }));
    await waitFor(() => expect(h.auth.resendVerification).toHaveBeenCalledWith('dev@example.com'));
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe('/login');
  });
  it('surfaces a sign-up failure', async () => {
    h.auth.signUp = vi.fn(async () => { throw new Error('User already registered'); });
    view(<SignupPage />); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect((await screen.findByRole('alert')).textContent.length).toBeGreaterThan(5);
  });
});

describe('ForgotPasswordPage', () => {
  it('sends the reset email and confirms with a success notice', async () => {
    view(<ForgotPasswordPage />);
    type(/^Email/, 'me@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    await waitFor(() => expect(h.auth.resetPassword).toHaveBeenCalledWith('me@example.com'));
    expect(await screen.findByText(/reset link is on its way/i)).toBeTruthy();
  });
});
