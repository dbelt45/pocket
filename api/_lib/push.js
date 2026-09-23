import webpush from "web-push";
import { logCall, todayInAustin, TZ } from "./supabase.js";
import { todaysEvents } from "./calendar.js";

// The retention mechanism: a push notification each morning. iOS allows web
// push only for an app added to the Home Screen (iOS 16.4 and later), and only
// after the person taps a button that asks for permission.
//
// The VAPID keys prove to Apple that a message really comes from this app.
// The public half goes to the phone; the private half stays in Vercel.

/** Send one notification to every phone this user has subscribed. Returns how many arrived. */
export async function sendToUser(supabase, userId, payload) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const { data: subs } = await supabase.from("push_subscriptions")
    .select("endpoint, p256dh, auth").eq("user_id", userId);
  let delivered = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload), { TTL: 60 * 60 * 6 });
      delivered++;
      await logCall(supabase, userId, "web_push", true, 201, `Delivered: ${payload.title}`);
    } catch (e) {
      // 404 or 410 means the phone removed the app or turned notifications off.
      // That subscription is dead forever, so delete it rather than retry daily.
      if (e.statusCode === 404 || e.statusCode === 410) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      }
      await logCall(supabase, userId, "web_push", false, e.statusCode ?? null, `Push failed: ${e.body || e.message}`);
    }
  }
  return { subscribed: subs?.length ?? 0, delivered };
}

/** The morning message: what is due, and how the day looks. */
export async function morningDigest(supabase, userId) {
  const today = todayInAustin();
  const { data: open } = await supabase.from("captures")
    .select("kind, due_on, ai_status").eq("user_id", userId).is("done_at", null);
  const rows = open ?? [];
  const due = (k) => rows.filter((r) => r.kind === k && r.due_on && r.due_on <= today).length;
  const followups = due("followup"), tasks = due("task");
  const unsorted = rows.filter((r) => r.ai_status !== "done").length;

  const parts = [];
  if (followups) parts.push(`${followups} follow-up${followups > 1 ? "s" : ""} due`);
  if (tasks) parts.push(`${tasks} task${tasks > 1 ? "s" : ""} due`);
  if (unsorted) parts.push(`${unsorted} not sorted yet`);
  let line = parts.length ? `${parts.join(", ")}.` : "Nothing due from Pocket today.";

  const cal = await todaysEvents(supabase, userId);
  if (cal.ok) {
    const timed = cal.events.filter((e) => !e.allDay);
    if (!timed.length) line += " No meetings today.";
    else {
      const first = new Date(timed[0].start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
      line += ` ${timed.length} meeting${timed.length > 1 ? "s" : ""}, first at ${first}.`;
    }
  }
  return { title: "Good morning, Daniel", body: line, url: "/" };
}
