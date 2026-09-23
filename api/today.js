import { asUser, unauthorized } from "./_lib/supabase.js";
import { todaysEvents } from "./_lib/calendar.js";

// GET /api/today - today's meetings from Google Calendar, for the strip at the top.
export default async function handler(req, res) {
  const who = await asUser(req);
  if (!who) return unauthorized(res);
  const result = await todaysEvents(who.supabase, who.user.id);
  res.status(result.ok ? 200 : 502).json(result);
}
