import { asUser, logCall, unauthorized } from "./_lib/supabase.js";

// POST /api/speak  { "text": "..." }  ->  mp3 of Jarvis saying it.
// Turns Jarvis's reply into audio with ElevenLabs. The voice is whichever id
// is in ELEVENLABS_VOICE_ID, so changing voice is a Vercel setting, not a deploy.
// Answers 204 when ElevenLabs is not set up or fails; the phone then falls
// back to its own built-in voice, so Jarvis is never silent.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const who = await asUser(req);
  if (!who) return unauthorized(res);

  const key = process.env.ELEVENLABS_API_KEY, voice = process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voice) return res.status(204).end();

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {};
  const text = String(body.text ?? "").trim().slice(0, 1000); // caps what one reply can cost
  if (!text) return res.status(400).end();

  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_64`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      // Flash is ElevenLabs' fastest model, so the answer starts quickly.
      body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5" }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      await logCall(who.supabase, who.user.id, "elevenlabs", false, r.status, await r.text());
      return res.status(204).end();
    }
    const audio = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(audio);
    await logCall(who.supabase, who.user.id, "elevenlabs", true, 200, `${text.length} chars`);
  } catch (e) {
    await logCall(who.supabase, who.user.id, "elevenlabs", false, 0, e.message);
    if (!res.headersSent) res.status(204).end();
  }
}
