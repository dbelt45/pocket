import { asUser, unauthorized } from "./_lib/supabase.js";
import { sendToUser, morningDigest } from "./_lib/push.js";

// POST /api/push-test - send this morning's reminder right now, to prove the
// whole chain works without waiting until tomorrow.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  const who = await asUser(req);
  if (!who) return unauthorized(res);
  const digest = await morningDigest(who.supabase, who.user.id);
  const result = await sendToUser(who.supabase, who.user.id, digest);
  res.status(result.delivered ? 200 : 502).json({ ok: result.delivered > 0, ...result, preview: digest });
}
