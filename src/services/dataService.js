import { supabase } from '../lib/supabase';
import { cleanText } from '../lib/validation';

const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};
const db = () => {
  if (!supabase) throw new Error('Backend is not configured.');
  return supabase;
};

/** PostgREST caps each response (default 1000 rows), so page through large tables explicitly. */
async function pageAll(build) {
  const size = 1000;
  const out = [];
  for (let from = 0; from < 100000; from += size) {
    const rows = must(await build().range(from, from + size - 1));
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

/** Table loaders. Row Level Security guarantees each query only ever returns the caller's rows. */
export const loaders = {
  profile: async (userId) => must(await db().from('profiles').select('*').eq('id', userId).maybeSingle()),
  portfolios: async () => must(await db().from('portfolios').select('*').order('created_at', { ascending: true })),
  assets: async () => must(await db().from('assets').select('*').order('name', { ascending: true })),
  holdings: async () => must(await db().from('holdings').select('*')),
  transactions: async () =>
    pageAll(() =>
      db()
        .from('transactions')
        .select('*')
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: true }),
    ),
  watchlist: async () => must(await db().from('watchlists').select('*').order('created_at', { ascending: false })),
  goals: async () => must(await db().from('goals').select('*').order('target_date', { ascending: true })),
  income: async () => pageAll(() => db().from('income').select('*').order('income_date', { ascending: false }).order('id', { ascending: true })),
  expenses: async () => pageAll(() => db().from('expenses').select('*').order('expense_date', { ascending: false }).order('id', { ascending: true })),
  budgets: async () => must(await db().from('budgets').select('*').order('category', { ascending: true })),
  liabilities: async () => must(await db().from('liabilities').select('*').order('created_at', { ascending: true })),
  notifications: async () => must(await db().from('notifications').select('*').order('created_at', { ascending: false }).limit(50)),
};
export const TABLE_KEYS = Object.keys(loaders).filter((k) => k !== 'profile');

// ---- profile ---------------------------------------------------------------------------------
export async function ensureProfile(user, preferredCurrency) {
  const existing = await loaders.profile(user.id);
  if (existing) return existing;
  return must(
    await db()
      .from('profiles')
      .insert({
        id: user.id,
        email: user.email,
        full_name: cleanText(user.user_metadata?.full_name ?? user.user_metadata?.name ?? '', 120) || null,
        preferred_currency: preferredCurrency,
      })
      .select()
      .single(),
  );
}
export async function updateProfile(userId, patch) {
  return must(await db().from('profiles').update(patch).eq('id', userId).select().single());
}
export async function uploadAvatar(userId, file) {
  const ok = ['image/jpeg', 'image/png', 'image/webp'];
  if (!ok.includes(file.type)) throw new Error('Use a JPG, PNG or WebP image.');
  if (file.size > 2 * 1024 * 1024) throw new Error('Image must be 2 MB or smaller.');
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${userId}/avatar-${Date.now()}.${ext}`;
  const up = await db().storage.from('avatars').upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) throw up.error;
  const { data } = db().storage.from('avatars').getPublicUrl(path);
  return data.publicUrl;
}

// ---- generic CRUD ----------------------------------------------------------------------------
function crud(table) {
  return {
    create: async (userId, values) => must(await db().from(table).insert({ ...values, user_id: userId }).select().single()),
    update: async (id, values) => must(await db().from(table).update(values).eq('id', id).select().single()),
    remove: async (id) => must(await db().from(table).delete().eq('id', id).select('id')),
  };
}
export const portfolios = crud('portfolios');
export const goals = crud('goals');
export const income = crud('income');
export const expenses = crud('expenses');
export const budgets = crud('budgets');
export const liabilities = crud('liabilities');
export const watchlist = crud('watchlists');
export const transactions = {
  ...crud('transactions'),
  // portfolio/asset are locked after creation (DB trigger); only these fields are editable.
  update: async (id, v) =>
    must(
      await db()
        .from('transactions')
        .update({ quantity: v.quantity, price: v.price, fees: v.fees, transaction_date: v.transaction_date, notes: v.notes })
        .eq('id', id)
        .select()
        .single(),
    ),
};

// ---- assets ----------------------------------------------------------------------------------
export const assets = {
  ...crud('assets'),
  async updatePrices(updates) {
    // One small UPDATE per asset; runs a few at a time.
    const queue = [...updates];
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const u = queue.shift();
        const { error } = await db()
          .from('assets')
          .update({ current_price: u.current_price, previous_close: u.previous_close, price_updated_at: u.price_updated_at })
          .eq('id', u.id);
        if (error) throw error;
      }
    });
    await Promise.all(workers);
  },
};

/**
 * Create (or reuse) an asset and record its opening position as a BUY (DEPOSIT for cash).
 * The database trigger turns that transaction into the holding row.
 */
export async function createAssetWithPosition(userId, { asset, existingAsset, position }) {
  let assetRow = existingAsset ?? null;
  let created = false;
  if (!assetRow) {
    assetRow = await assets.create(userId, asset);
    created = true;
  }
  try {
    if (position) {
      await transactions.create(userId, {
        portfolio_id: position.portfolio_id,
        asset_id: assetRow.id,
        type: assetRow.asset_type === 'Cash' ? 'DEPOSIT' : 'BUY',
        quantity: position.quantity,
        price: assetRow.asset_type === 'Cash' ? 1 : position.price,
        fees: position.fees ?? 0,
        currency: assetRow.currency,
        transaction_date: position.date,
        notes: position.notes ?? null,
      });
    }
  } catch (e) {
    if (created) await assets.remove(assetRow.id).catch(() => {});
    throw e;
  }
  return assetRow;
}

// ---- notifications / screener ----------------------------------------------------------------
export async function addNotification(userId, n) {
  const { error } = await db()
    .from('notifications')
    .upsert({ ...n, user_id: userId }, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
  if (error) throw error;
}
export const markNotificationsRead = async (ids) => must(await db().from('notifications').update({ is_read: true }).in('id', ids).select('id'));
export const deleteNotification = async (id) => must(await db().from('notifications').delete().eq('id', id).select('id'));

export async function loadScreenerResult(userId, universe) {
  return must(await db().from('screener_results').select('*').eq('user_id', userId).eq('universe', universe).maybeSingle());
}
export async function saveScreenerResult(userId, universe, criteria, results) {
  return must(
    await db()
      .from('screener_results')
      .upsert({ user_id: userId, universe, criteria, results, run_at: new Date().toISOString() }, { onConflict: 'user_id,universe' })
      .select('id')
      .single(),
  );
}
