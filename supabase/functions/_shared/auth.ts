import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient, User } from 'npm:@supabase/supabase-js@2';
import { json } from './cors.ts';

export type AuthResult =
  | { error: Response; user?: undefined; supabase?: undefined }
  | { error: null; user: User; supabase: SupabaseClient };

/** Verifies the caller's Supabase JWT. Returns the user, or a ready-made 401 Response. */
export async function requireUser(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return { error: json(req, { error: 'Not authenticated' }, 401) };
  }
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { error: json(req, { error: 'Not authenticated' }, 401) };
  return { error: null, user: data.user, supabase };
}
