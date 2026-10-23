// POST { confirm: 'DELETE' } -> permanently deletes the caller's auth user. All user rows are removed by
// ON DELETE CASCADE; avatar files are removed here. Uses the service-role key, which never leaves the server.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { preflight, json, safeHandler } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { rateLimited } from '../_shared/ratelimit.ts';

Deno.serve(safeHandler(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const auth = await requireUser(req);
  if (auth.error) return auth.error;
  if (rateLimited(`del:${auth.user.id}`, 3, 60_000)) return json(req, { error: 'Too many requests.' }, 429);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: 'Invalid JSON body' }, 400);
  }
  if (body?.confirm !== 'DELETE') return json(req, { error: 'Confirmation required' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const { data: files } = await admin.storage.from('avatars').list(auth.user.id);
    if (files?.length) await admin.storage.from('avatars').remove(files.map((f) => `${auth.user.id}/${f.name}`));
    const { error } = await admin.auth.admin.deleteUser(auth.user.id);
    if (error) throw error;
    return json(req, { deleted: true });
  } catch (e) {
    console.error('delete-account error', e);
    return json(req, { error: 'Could not delete the account. Please contact support.' }, 500);
  }
}));
