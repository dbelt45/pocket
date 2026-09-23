import { TZ, logCall } from "./supabase.js";

// The external API: Google Calendar v3. Reads today's (or any day's) events,
// adds events and deletes them. It reuses the Google token Daniel OS stored at
// sign-in, so Pocket needs no Google login of its own.
//
// Nothing here throws. Every function returns { ok: true, ... } or
// { ok: false, message } and logs the outcome to integration_log.

const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/** Austin's UTC offset on a given day, like "-05:00". Handles daylight saving per date. */
function offsetOn(ymd) {
  const noon = new Date(`${ymd}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" })
    .formatToParts(noon).find((p) => p.type === "timeZoneName").value.replace("GMT", "") || "Z";
}

/** Add days to a YYYY-MM-DD date. */
export function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "2026-09-24T14:00" plus 30 minutes, as wall-clock time. Google applies the timezone. */
function addMinutes(local, mins) {
  const [d, t] = local.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  return new Date(Date.UTC(y, mo - 1, da, h, mi + mins)).toISOString().slice(0, 16);
}

/**
 * Call Google with Daniel's token. Renews the token and retries once on a 401,
 * because Google's access token only lives for an hour.
 */
async function google(supabase, userId, url, init = {}) {
  const log = (ok, status, msg) => logCall(supabase, userId, "google_calendar", ok, status, `[pocket] ${msg}`);
  const { data: tok } = await supabase.from("integration_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId).eq("provider", "google").maybeSingle();
  if (!tok?.access_token) {
    await log(false, null, "No Google token stored.");
    return { ok: false, message: "Calendar not connected. Sign in to Daniel OS with Google once." };
  }

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

  try {
    let token = tok.access_token;
    if (tok.expires_at && new Date(tok.expires_at) < new Date()) token = (await refresh()) ?? token;
    const call = (t) => fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${t}` } });
    let res = await call(token);
    if (res.status === 401) {
      const fresh = await refresh();
      if (fresh) res = await call(fresh);
    }
    const what = `${init.method ?? "GET"} ${new URL(url).pathname.split("/").pop()}`;
    if (res.ok) {
      const json = res.status === 204 ? {} : await res.json();
      await log(true, res.status, what);
      return { ok: true, json };
    }
    const raw = await res.text();
    const why = raw.match(/"message":\s*"([^"]+)"/)?.[1] ?? "no reason given";
    await log(false, res.status, `${what}: ${why}`);
    if (/insufficient/i.test(raw)) {
      return { ok: false, message: "I can read your calendar but not change it yet. Sign out of Daniel OS and back in to allow editing." };
    }
    if (res.status === 401 || res.status === 403) return { ok: false, message: "Google access expired. Sign out of Daniel OS and back in." };
    if (res.status === 404 || res.status === 410) return { ok: false, message: "That event no longer exists." };
    return { ok: false, message: `Calendar error ${res.status}.` };
  } catch (e) {
    await log(false, null, `Network failure calling Google: ${e.message}`);
    return { ok: false, message: "Could not reach Google Calendar." };
  }
}

const shape = (e) => ({
  id: String(e.id),
  summary: e.summary ?? "(no title)",
  start: e.start?.dateTime ?? e.start?.date ?? null,
  allDay: !e.start?.dateTime,
});

/** Events from the start of `fromYmd` for `days` days, Austin time. */
export async function eventsBetween(supabase, userId, fromYmd, days = 1) {
  const toYmd = addDays(fromYmd, days - 1);
  const url = new URL(API);
  url.searchParams.set("timeMin", `${fromYmd}T00:00:00${offsetOn(fromYmd)}`);
  url.searchParams.set("timeMax", `${toYmd}T23:59:59${offsetOn(toYmd)}`);
  url.searchParams.set("singleEvents", "true"); // expand recurring meetings into each day's copy
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "50");
  const r = await google(supabase, userId, url.href);
  return r.ok ? { ok: true, events: (r.json.items ?? []).map(shape) } : r;
}

export async function todaysEvents(supabase, userId) {
  return eventsBetween(supabase, userId, new Date().toLocaleDateString("en-CA", { timeZone: TZ }), 1);
}

/**
 * Add an event. `start` is Austin wall-clock time "YYYY-MM-DDTHH:MM", or pass
 * `allDayDate` "YYYY-MM-DD" for an all-day event.
 */
export async function addEvent(supabase, userId, { title, start, minutes = 30, allDayDate }) {
  let body;
  if (allDayDate) {
    body = { summary: title, start: { date: allDayDate }, end: { date: addDays(allDayDate, 1) } };
  } else {
    body = { summary: title,
      start: { dateTime: `${start}:00`, timeZone: TZ },
      end: { dateTime: `${addMinutes(start, minutes)}:00`, timeZone: TZ } };
  }
  const r = await google(supabase, userId, API, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return r.ok ? { ok: true, event: shape(r.json) } : r;
}

export async function getEvent(supabase, userId, eventId) {
  const r = await google(supabase, userId, `${API}/${encodeURIComponent(eventId)}`);
  return r.ok ? { ok: true, event: shape(r.json) } : r;
}

export async function deleteEvent(supabase, userId, eventId) {
  const r = await google(supabase, userId, `${API}/${encodeURIComponent(eventId)}`, { method: "DELETE" });
  return r.ok ? { ok: true } : r;
}
