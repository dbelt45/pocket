import { createHash } from "node:crypto";
import { asUser, asAdmin, unauthorized } from "./_lib/supabase.js";
import { handle } from "./_lib/jarvis.js";

// POST /api/jarvis  { "text": "what's on my calendar today" }
// Answers { "say": "...", "listen": "yes" when Jarvis expects a reply }.
//
// Two ways in, one brain:
// - The Pocket app sends the signed-in session, like every other call.
// - The Siri shortcut cannot sign in, so it sends Daniel's personal Jarvis key
//   ("pk_..."). Only the key's fingerprint is stored, so we fingerprint what
//   arrived and look that up. Delete the row in jarvis_tokens to switch it off.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  let who = null;
  const auth = req.headers.authorization ?? "";
  if (auth.startsWith("Bearer pk_")) {
    const hash = createHash("sha256").update(auth.slice(7).trim()).digest("hex");
    const admin = asAdmin();
    const { data } = await admin.from("jarvis_tokens").select("user_id").eq("token_hash", hash).maybeSingle();
    if (data) {
      who = { supabase: admin, userId: data.user_id, source: "siri" };
      await admin.from("jarvis_tokens").update({ last_used_at: new Date().toISOString() }).eq("token_hash", hash);
    }
  } else {
    const u = await asUser(req);
    if (u) who = { supabase: u.supabase, userId: u.user.id, source: "app" };
  }
  if (!who) return unauthorized(res);

  const text = typeof req.body === "string" ? JSON.parse(req.body || "{}").text : req.body?.text;
  const reply = await handle(who.supabase, who.userId, text);

  // Analytics: which way in, which actions ran. The words themselves are not logged here.
  await who.supabase.from("events").insert({
    user_id: who.userId, kind: "action", name: "pocket:jarvis", path: "/api/jarvis",
    meta: { app: "pocket", source: who.source, actions: reply.used ?? [], listen: !!reply.listen, failed: !!reply.error },
  });
  res.status(200).json({ ok: !reply.error, say: reply.say, ...(reply.listen ? { listen: reply.listen } : {}) });
}
