import { asAdmin } from "../_lib/supabase.js";
import { sendToUser, morningDigest } from "../_lib/push.js";

// GET /api/cron/morning - Vercel calls this once a day (schedule in vercel.json).
// Vercel sends "Authorization: Bearer <CRON_SECRET>". Anyone else is refused,
// so a stranger cannot make the app spam notifications.
export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false });
  }
  const admin = asAdmin();
  const { data: subs, error } = await admin.from("push_subscriptions").select("user_id");
  if (error) return res.status(500).json({ ok: false, message: error.message });

  const results = [];
  for (const userId of new Set(subs.map((s) => s.user_id))) {
    const digest = await morningDigest(admin, userId);
    results.push({ userId, ...(await sendToUser(admin, userId, digest)) });
  }
  // Vercel keeps this response in the cron log, so a missed morning is visible there too.
  res.status(200).json({ ok: true, results });
}
