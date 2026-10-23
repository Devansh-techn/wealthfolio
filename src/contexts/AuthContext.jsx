import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { SESSION_FLAG } from '../lib/constants';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [recovery, setRecovery] = useState(false);
  const hadSession = useRef(false);
  const manualSignOut = useRef(false);

  useEffect(() => {
    if (!supabase) return undefined;
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      hadSession.current = Boolean(data.session);
      setSession(data.session);
      setLoading(false);
    });
    // NOTE: keep this callback synchronous; calling other supabase APIs inside it can deadlock.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'SIGNED_OUT' && hadSession.current && !manualSignOut.current) {
        try {
          sessionStorage.setItem(SESSION_FLAG, '1');
        } catch {
          /* ignore */
        }
      }
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      hadSession.current = Boolean(next);
      setSession(next);
      setLoading(false);
    });
    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const signUp = useCallback(
    async ({ email, password, fullName, currency }) => {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${origin}/auth/callback`,
          data: { full_name: fullName, preferred_currency: currency },
        },
      });
      if (error) throw error;
      return { needsVerification: !data.session };
    },
    [origin],
  );

  const signIn = useCallback(async ({ email, password }) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${origin}/auth/callback` } });
    if (error) throw error;
  }, [origin]);

  const signOut = useCallback(async () => {
    manualSignOut.current = true;
    try {
      await supabase.auth.signOut();
    } finally {
      manualSignOut.current = false;
    }
  }, []);

  const resetPassword = useCallback(
    async (email) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${origin}/reset-password` });
      if (error) throw error;
    },
    [origin],
  );

  const updatePassword = useCallback(async (password) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    setRecovery(false);
  }, []);

  const resendVerification = useCallback(
    async (email) => {
      const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: `${origin}/auth/callback` } });
      if (error) throw error;
    },
    [origin],
  );

  const value = useMemo(
    () => ({
      configured: isSupabaseConfigured,
      session,
      user: session?.user ?? null,
      loading,
      recovery,
      signUp,
      signIn,
      signInWithGoogle,
      signOut,
      resetPassword,
      updatePassword,
      resendVerification,
    }),
    [session, loading, recovery, signUp, signIn, signInWithGoogle, signOut, resetPassword, updatePassword, resendVerification],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
