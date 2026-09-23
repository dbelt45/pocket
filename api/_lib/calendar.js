import { TZ, logCall } from "./supabase.js";

// The external API: Google Calendar, today's events. Ported from Daniel OS
// (daniel-os/lib/google-calendar.ts) and reuses the token Daniel OS stored when
// he signed in with Google, so Pocket needs no Google login of its own.
// Never throws. Returns { ok: true, events } or { ok: false, message }.
export async function todaysEvents(supabase, userId) {
  const log = (ok, status, msg) => logCall(supabase, userId, "google_calendar", ok, status, `[pocket] ${msg}`);

  const { data: tok } = await supabase.from("integration_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId).eq("provider", "google").maybeSingle();

  if (!tok?.access_token) {
    await log(false, null, "No Google token stored.");
    return { ok: false, message: "Calendar not connected. Sign in to Daniel OS with Google once." };
  }

  // Google's access token lasts an hour. The refresh token buys a new one.
  const refresh = async () => {
    const id = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
    if (!tok.refresh_token || !id || !secret) return null;
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({ client_id: id, client_secret: secret,
        refresh_token: tok.refresh_token, grant_type: "refresh_token" }),
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    if (!json?.access_token) {
      await log(false, res?.status ?? null, `Google refused the refresh: ${json?.error ?? "no response"}.`);
      return null;
    }
    await supabase.from("integration_tokens").update({
      access_token: json.access_token,
      expires_at: new Date(Date.now() + (json.expires_in - 300) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("provider", "google");
    return json.access_token;
  };

  const now = new Date();
  const ymd = now.toLocaleDateString("en-CA", { timeZone: TZ });
  // ponytail: Austin's offset right now; on the two daylight-saving switch days the window is an hour off.
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" })
    .formatToParts(now).find((p) => p.type === "timeZoneName").value.replace("GMT", "") || "Z";
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", `${ymd}T00:00:00${offset}`);
  url.searchParams.set("timeMax", `${ymd}T23:59:59${offset}`);
  url.searchParams.set("singleEvents", "true"); // expand recurring meetings into today's copy
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "20");

  try {
    let token = tok.access_token;
    if (tok.expires_at && new Date(tok.expires_at) < now) token = (await refresh()) ?? token;
    const call = (t) => fetch(url, { headers: { Authorization: `Bearer ${t}` } });
    let res = await call(token);
    if (res.status === 401) {
      const fresh = await refresh();
      if (fresh) res = await call(fresh);
    }
    if (!res.ok) {
      const why = (await res.text()).match(/"message":\s*"([^"]+)"/)?.[1] ?? "no reason given";
      await log(false, res.status, `Calendar API ${res.status}: ${why}`);
      return { ok: false, message: res.status === 401 || res.status === 403
        ? "Google access expired. Sign out of Daniel OS and back in."
        : `Calendar error ${res.status}.` };
    }
    const json = await res.json();
    const events = (json.items ?? []).map((e) => ({
      summary: e.summary ?? "(no title)",
      start: e.start?.dateTime ?? e.start?.date ?? null,
      allDay: !e.start?.dateTime,
    }));
    await log(true, 200, `Fetched ${events.length} event(s).`);
    return { ok: true, events };
  } catch (e) {
    await log(false, null, `Network failure calling Google: ${e.message}`);
    return { ok: false, message: "Could not reach Google Calendar." };
  }
}
