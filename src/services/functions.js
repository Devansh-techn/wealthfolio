import { supabase } from '../lib/supabase';

const STATUS_COPY = {
  401: 'Not authenticated',
  404: 'This service is not available right now.',
  429: 'Too many requests. Please wait a moment and try again.',
};

/**
 * Turn a supabase-js Functions error into an Error with a SAFE, accurate, user-facing message and:
 *   err.kind   'http'        our function answered with an error status (its own `error` text is safe and used)
 *              'relay'       the Supabase platform could not run the function (cold start / outage)
 *              'unreachable' the request never got a readable response: offline, function not deployed,
 *                            blocked by CORS, or a crash that returned no CORS headers (browsers report all of
 *                            these as the same opaque "Failed to fetch")
 *   err.status HTTP status when there is one
 */
async function toFunctionError(error, name) {
  const kind = error.name === 'FunctionsHttpError' ? 'http' : error.name === 'FunctionsRelayError' ? 'relay' : 'unreachable';
  const status = error.context?.status;
  let message;
  if (kind === 'http') {
    try {
      const j = await error.context.json();
      if (typeof j?.error === 'string') message = j.error;
      else if (typeof j?.message === 'string' && status === 401) message = j.message; // platform JWT rejection, e.g. "Invalid JWT"
    } catch {
      /* body was not JSON */
    }
    message ||= STATUS_COPY[status] ?? 'The service returned an error. Please try again.';
  } else if (kind === 'relay') {
    message = 'The service is starting up or temporarily unavailable. Please try again.';
  } else {
    message = typeof navigator !== 'undefined' && navigator.onLine === false ? 'You appear to be offline. Check your connection and retry.' : 'The service could not be reached. Please try again shortly.';
    if (import.meta.env.DEV) {
      console.warn(`[invokeFunction] "${name}" returned no readable response. If you are offline this is expected; otherwise the Edge Function is probably not deployed, or the browser blocked it (missing CORS headers). Run \`npm run check:functions\` to see which.`);
    }
  }
  const e = new Error(message);
  e.kind = kind;
  e.status = status;
  return e;
}

/** Invoke a Supabase Edge Function and normalise errors to a plain Error with a safe message. */
export async function invokeFunction(name, body) {
  if (!supabase) throw new Error('Backend is not configured.');
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw await toFunctionError(error, name);
  return data;
}
