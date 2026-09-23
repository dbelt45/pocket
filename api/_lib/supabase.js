import { createClient } from "@supabase/supabase-js";

// Vercel's servers run on UTC. "Today" always means today in Austin.
export const TZ = "America/Chicago";
export const todayInAustin = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: TZ });

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

/**
 * A database client that acts AS the signed-in user, so row-level security
 * applies exactly as it does in the browser. The phone sends its session token
 * in the Authorization header; we ask Supabase who that token belongs to
 * instead of trusting anything the phone says about itself.
 */
export async function asUser(req) {
  const jwt = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  if (!jwt) return null;
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
    ...opts, global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data.user) return null;
  return { supabase, user: data.user };
}

/**
 * A client that ignores row-level security. Only the morning reminder uses it,
 * because a scheduled job has no signed-in user. The secret key lives in Vercel
 * and never reaches a browser.
 */
export function asAdmin() {
  if (!process.env.SUPABASE_SECRET_KEY) throw new Error("SUPABASE_SECRET_KEY is not set.");
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, opts);
}

/** Every outside call lands here, success or failure, so the last failure is always visible. */
export async function logCall(supabase, userId, provider, ok, status, message) {
  await supabase.from("integration_log").insert({
    user_id: userId, provider, ok, status, message: String(message).slice(0, 500),
  });
}

export function unauthorized(res) {
  return res.status(401).json({ ok: false, message: "Not signed in." });
}
