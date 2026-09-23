import { randomUUID } from "node:crypto";
import { complete, giveFeedback, JARVIS_MODELS, DASHES } from "./ai.js";
import { TZ, todayInAustin, logCall } from "./supabase.js";
import { eventsBetween, addEvent, getEvent, deleteEvent, addDays } from "./calendar.js";

// Jarvis: turns one spoken sentence into an answer, and sometimes an action.
//
// How a sentence is handled, in order:
// 1. Is Jarvis waiting on something? ("What are you thinking?" or "delete X?")
//    Then this sentence is the answer to that question.
// 2. Does it start with "Jarvis, I have a thought"? Then it is a thought.
//    This is plain pattern matching, no AI, so it always works and costs nothing.
// 3. Is it a plain question about his day, calendar, tasks, follow-ups, notes
//    or thoughts? Then answer straight from the data. No AI, under a second.
// 4. Anything else goes to the AI model with the list of actions below. The
//    model can only do what this list allows, and the code runs each action.
//    His open tasks are in the prompt, so "check off X" is one AI call, and the
//    reply after a simple action is written by code, not a second AI call.
//
// Deleting anything is never done in one step. Jarvis asks first, and only a
// "yes" on the next sentence carries it out. A misheard word cannot wipe out a
// meeting.

export const WAKE = /^\s*(hey|ok|okay)?[\s,]*jarvis[\s,.!:-]*/i;
export const THOUGHT = /^\s*(hey|ok|okay)?[\s,]*(jarvis[\s,.!:-]*)?i(\s+(have|had|got)|['’]ve(\s+got)?)\s+(a|an)\s+(thought|idea)\b[\s,.:!-]*/i;
export const YES = /^\s*(yes|yeah|yep|yup|sure|correct|do it|go ahead|confirm|please do|delete it|remove it)\b/i;
const WAIT_MINUTES = 2;

const SPOKEN = `You are Jarvis, Daniel Belt's assistant. Daniel is Director of Operations at
Turnkey Services. Your reply is READ OUT LOUD by his phone, so:
- One to three short sentences, under 40 words. No lists, no markdown, no asterisks, no emoji, no URLs.
- Say times the way a person would: "two thirty", "ten in the morning".
- Answer first. Never recap what you looked up.
- Never use an em dash or an en dash.
- Only state what an action returned. Never invent a task, a meeting or a number.
- Use the "day" and "over" fields as given. Never work out a weekday yourself.
- If an action fails, say so plainly and say what it said.
- To remove a task or a calendar event, call the delete action. Daniel is asked to
  confirm automatically, so do not ask him yourself.
- "My to-do list" means his tasks. "Remove" or "take off" a task means delete it.
  "Done", "finished" or "check off" means complete it.`;

/** The AI's instructions. ctx.tasks and ctx.events (with ids) let it act in one step. */
export function systemPrompt(ctx = {}) {
  let p = `${SPOKEN}\n\nRight now it is ${nowInAustin()} in Austin, Texas. Today's date is ${todayInAustin()}.`;
  if (ctx.tasks) {
    const lines = ctx.tasks.map((t) => `${t.id}: ${t.title}${t.due_on ? `, due ${t.due_on}` : ""}`);
    p += `\n\nDaniel's open tasks (id: title, due):\n${lines.join("\n") || "none"}`;
  }
  if (ctx.events) {
    const lines = ctx.events.map((e) => `${e.id}: ${e.allDay ? `${e.start} all day` : `${e.start.slice(0, 10)} ${clockTime(e.start)}`}, ${e.summary}`);
    p += `\n\nHis calendar, next 14 days (id: when, title):\n${lines.join("\n") || "none"}`;
  }
  return p;
}

const fn = (name, description, properties = {}, required = []) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
});

export const TOOLS = [
  fn("get_overview", "A spoken summary of Daniel's day: today's meetings, tasks due or overdue, follow-ups due, and recent thoughts. Use for 'what's on today', 'summarize my day', 'what do I need to know'."),
  fn("list_tasks", "Daniel's open to-do list, with ids. Only needed if the task is not already in your instructions."),
  fn("add_task", "Add a task to Daniel's to-do list.", {
    title: { type: "string", description: "The task, short, starting with a verb." },
    due_on: { type: "string", description: "YYYY-MM-DD, only if he gave a day." },
  }, ["title"]),
  fn("complete_task", "Mark a task done. Use the id from the task list in your instructions.", { task_id: { type: "string" } }, ["task_id"]),
  fn("delete_task", "Remove a task from the list entirely. Use the id from the task list in your instructions. Daniel will be asked to confirm.",
    { task_id: { type: "string" } }, ["task_id"]),
  fn("list_calendar", "Calendar events, with ids, starting on a date for a number of days.", {
    start_date: { type: "string", description: "YYYY-MM-DD. Today if he did not say." },
    days: { type: "integer", description: "How many days, 1 to 14. Default 1." },
  }, ["start_date"]),
  fn("add_calendar_event", "Put an event on Daniel's Google Calendar.", {
    title: { type: "string" },
    start: { type: "string", description: "Austin local time as YYYY-MM-DDTHH:MM (24 hour). Omit for an all-day event." },
    minutes: { type: "integer", description: "Length in minutes. Default 30." },
    all_day_date: { type: "string", description: "YYYY-MM-DD, only for an all-day event." },
  }, ["title"]),
  fn("delete_calendar_event", "Remove an event from Google Calendar. Use the id from the calendar in your instructions, or from list_calendar. Daniel will be asked to confirm.",
    { event_id: { type: "string" } }, ["event_id"]),
  fn("list_captures", "Things Daniel captured in Pocket: follow-ups, notes or thoughts.", {
    kind: { type: "string", enum: ["followup", "note", "thought"] },
  }, ["kind"]),
];

const say = (text, listen = false) => ({ say: text, ...(listen ? { listen: "yes" } : {}) });

const nowInAustin = () => new Date().toLocaleString("en-US", {
  weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ,
});
const clockTime = (iso) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });

// ------------------------------------------------------------------ state
async function getState(supabase, userId) {
  const { data } = await supabase.from("jarvis_state").select("awaiting, payload, expires_at")
    .eq("user_id", userId).maybeSingle();
  return data && new Date(data.expires_at) > new Date() ? data : null;
}
async function setState(supabase, userId, awaiting, payload = null) {
  await supabase.from("jarvis_state").upsert({ user_id: userId, awaiting, payload,
    expires_at: new Date(Date.now() + WAIT_MINUTES * 60e3).toISOString() });
}
async function clearState(supabase, userId) {
  await supabase.from("jarvis_state").delete().eq("user_id", userId);
}

// ------------------------------------------------------------ the one entry point
// Returns { say, listen?, used, timing, later? }. `later` is work to finish after
// the reply is sent (thought feedback), so Daniel never waits on it.
export async function handle(supabase, userId, rawText) {
  const t0 = Date.now();
  const timing = { path: "", ai: [], ms: 0 };
  const done = (r, path) => ({ ...r, used: r.used ?? [], timing: { ...timing, path, used: r.used ?? [], ms: Date.now() - t0 } });

  const text = String(rawText ?? "").trim().slice(0, 4000);
  if (!text) return done(say("I didn't catch that."), "empty");

  const command = text.replace(WAKE, "") || text;
  // The waiting-state check and the lists the AI needs run at the same time.
  const wantsCalendarIds = WRITES.test(command) && CALENDAR_WORDS.test(command);
  const [state, tasks, events] = await Promise.all([
    getState(supabase, userId),
    openTasks(supabase, userId),
    wantsCalendarIds ? eventsBetween(supabase, userId, todayInAustin(), 14).then((r) => (r.ok ? r.events : null)) : null,
  ]);
  timing.db_ms = Date.now() - t0;
  if (state) await clearState(supabase, userId);

  if (state?.awaiting === "thought") return done(await saveThought(supabase, userId, command), "thought");
  if (state?.awaiting === "confirm") {
    if (!YES.test(text)) return done(say("Okay, I left it alone."), "confirm");
    return done(await runDelete(supabase, userId, state.payload), "confirm");
  }

  const t = text.match(THOUGHT);
  if (t) {
    const rest = text.slice(t[0].length).trim();
    // "Jarvis, I have a thought, what if..." said in one breath: save it now.
    if (rest.split(/\s+/).length >= 4) return done(await saveThought(supabase, userId, rest), "thought");
    await setState(supabase, userId, "thought");
    return done(say("What are you thinking?", true), "thought");
  }

  const quick = await quickAnswer(supabase, userId, command, tasks);
  if (quick) return done(quick, "quick");

  return done(await agent(supabase, userId, command, { tasks, events: events ?? undefined }, timing), "ai");
}

async function openTasks(supabase, userId) {
  const { data } = await supabase.from("tasks").select("id, title, due_on").eq("user_id", userId)
    .neq("status", "done").order("due_on", { nullsFirst: false }).limit(40);
  return data ?? [];
}

// ---------------------------------------------------------------- thoughts
// Saved at once. The AI feedback (about 20 seconds) runs after the reply is
// sent (`later`), so Daniel is not left waiting on it.
async function saveThought(supabase, userId, body) {
  const row = { id: randomUUID(), user_id: userId, body, kind: "thought", ai_status: "done",
    ai_note: "Saved by Jarvis", captured_at: new Date().toISOString() };
  const { error } = await supabase.from("captures").insert(row);
  if (error) return say(`I couldn't save that thought. The database said: ${error.message}`);
  const log = (ok, status, msg) => logCall(supabase, userId, "openrouter", ok, status, `[pocket] ${msg}`);
  const later = giveFeedback(supabase, userId, row, todayInAustin(), log).catch(() => null);
  return { ...say("Got it. Saved to Thoughts. The feedback will be in the app in about twenty seconds."), later };
}

// ------------------------------------------------------- answers with no AI
// Plain questions about his own data are answered straight from the data.
// Anything that changes something, or does not clearly match, goes to the AI.
export const WRITES = /\b(add|put|create|make|remove|delete|cancel|clear|take\b.*\boff|check\b.*\boff|complete|mark|finish|move|reschedule|change|rename|book|set up)\b/i;
const QUESTION = /^\s*(what|what's|whats|what are|how many|how's|hows|how is|how does|do i|did i|is there|are there|any|anything|read|tell me|give me|list|show|go over|run through|summari[sz]e|brief me)\b/i;
const CALENDAR_WORDS = /\b(calendar|schedule|meeting|meetings|event|events|appointment|appointments|agenda|o'?clock|\d{1,2}(:\d\d)?\s*(am|pm|a\.m\.|p\.m\.))(?=\W|$)/i;
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Which days a question is about: { start, days, label }, or null if unclear. */
export function whichDays(text, today) {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (/\btomorrow\b/i.test(text)) return { start: addDays(today, 1), days: 1, label: "tomorrow" };
  if (/\bnext week\b/i.test(text)) return { start: addDays(today, 8 - (dow || 7)), days: 7, label: "next week" };
  if (/\b(this week|the week|rest of the week)\b/i.test(text)) return { start: today, days: (7 - dow) % 7 + 1, label: "this week" };
  const d = DAYS.findIndex((n) => new RegExp(`\\b${n}\\b`, "i").test(text));
  if (d > -1) {
    const ahead = (d - dow + 7) % 7;
    return { start: addDays(today, ahead), days: 1, label: ahead === 0 ? "today" : `on ${DAYS[d][0].toUpperCase()}${DAYS[d].slice(1)}` };
  }
  if (/\b(today|tonight|this (morning|afternoon|evening))\b/i.test(text)) return { start: today, days: 1, label: "today" };
  if (/\b(next|last|in \d|on the|\d{1,2}(st|nd|rd|th)|january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(text)) return null;
  return { start: today, days: 1, label: "today" };
}

/** Which no-AI answer fits: "calendar" | "tasks" | "followup" | "note" | "thought" | "overview", or null for the AI. */
export function quickRoute(text, today) {
  if (WRITES.test(text) || !QUESTION.test(text)) return null;
  const aboutTasks = /\b(to-?dos?|to do list|tasks?)\b/i.test(text);
  const kind = /\bfollow[- ]?ups?\b/i.test(text) ? "followup" : /\b(thoughts?|ideas?)\b/i.test(text) ? "thought" : /\bnotes?\b/i.test(text) ? "note" : null;
  const aboutCal = CALENDAR_WORDS.test(text);
  if ([aboutTasks, !!kind, aboutCal].filter(Boolean).length > 1) return null; // mixed question: the AI handles it
  if (aboutCal) return whichDays(text, today) ? "calendar" : null;
  if (aboutTasks) return "tasks";
  if (kind) return kind;
  if (/\b(my day|today|my plate|to know|brief|summar|going on|on deck)/i.test(text)) return "overview";
  return null;
}

async function quickAnswer(supabase, userId, text, tasks) {
  const today = todayInAustin();
  const route = quickRoute(text, today);
  if (route === "calendar") {
    const when = whichDays(text, today);
    const r = await runTool(supabase, userId, "list_calendar", { start_date: when.start, days: when.days });
    return { ...say(speakEvents(r, when)), used: ["list_calendar"] };
  }
  if (route === "tasks") return { ...say(speakTasks(tasks, today)), used: ["list_tasks"] };
  if (route === "overview") return { ...say(speakOverview(await runTool(supabase, userId, "get_overview", {}))), used: ["get_overview"] };
  if (route) return { ...say(speakCaptures(await runTool(supabase, userId, "list_captures", { kind: route }), route)), used: ["list_captures"] };
  return null;
}

// ------------------------------------------------------------ spoken replies
/** Make AI text safe to read aloud: no markdown, no dashes, one paragraph. */
export const spoken = (t) => String(t ?? "")
  .replace(/[*_`#>]+/g, "").replace(DASHES, ", ")
  .replace(/\s*\n+\s*/g, " ").replace(/\s+,/g, ",").replace(/ {2,}/g, " ").trim();
const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const count = (n, one, many = `${one}s`) => `${n === 0 ? "no" : n === 1 ? "one" : n} ${n === 1 ? one : many}`;
const spokenTime = (s) => s.replace(":00", "");
function spokenDay(ymd) {
  const today = todayInAustin();
  if (ymd === today) return "today";
  if (ymd === addDays(today, 1)) return "tomorrow";
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

export function speakOverview(o) {
  const parts = [];
  if (typeof o.meetings === "string") parts.push("I can't reach your calendar right now.");
  else if (!o.meetings.length) parts.push("No meetings today.");
  else parts.push(`You have ${count(o.meetings.length, "meeting")} today: ${list(o.meetings.map((m) => `${m.summary} ${m.at === "all day" ? "all day" : `at ${spokenTime(m.at)}`}`))}.`);
  if (o.tasks_due_today.length) parts.push(`Due today: ${list(o.tasks_due_today.slice(0, 3))}.`);
  if (o.tasks_overdue.length) parts.push(`${count(o.tasks_overdue.length, "task")} ${o.tasks_overdue.length === 1 ? "is" : "are"} overdue.`);
  if (!o.tasks_due_today.length && !o.tasks_overdue.length) parts.push(`You have ${count(o.open_tasks_total, "open task")}, nothing due today.`);
  if (o.followups_due.length) parts.push(`Follow up with: ${list(o.followups_due.slice(0, 3))}.`);
  return parts.join(" ");
}
export function speakTasks(tasks, today) {
  if (!tasks.length) return "Your to-do list is empty.";
  const late = tasks.filter((t) => t.due_on && t.due_on < today).length;
  const names = tasks.slice(0, 5).map((t) => t.title);
  return `You have ${count(tasks.length, "open task")}${late ? `, ${late} overdue` : ""}: ${list(names)}${tasks.length > 5 ? `, plus ${tasks.length - 5} more in the app` : ""}.`;
}
export function speakEvents(r, when) {
  if (r.error) return `I can't reach your calendar right now. ${r.error}`;
  const Label = `${when.label[0].toUpperCase()}${when.label.slice(1)}`;
  if (!r.events.length) return `${Label} your calendar is clear.`;
  const many = when.days > 1;
  const items = r.events.slice(0, 6).map((e) => {
    const [d, ...t] = e.when.split(" ");
    const time = t.join(" ") === "all day" ? "all day" : `at ${spokenTime(t.join(" "))}`;
    return `${e.summary}${many ? ` ${spokenDay(d)}` : ""} ${time}`;
  });
  return `${Label} you have ${count(r.events.length, "event")}: ${list(items)}${r.events.length > 6 ? `, plus ${r.events.length - 6} more` : ""}.`;
}
export function speakCaptures(r, kind) {
  const word = { followup: "follow-up", note: "note", thought: "thought" }[kind];
  if (r.error) return `I couldn't read your ${word}s. ${r.error}`;
  if (!r.items.length) return `You have no open ${word}s.`;
  return `You have ${count(r.items.length, word)}: ${list(r.items.slice(0, 4).map((i) => `${i.text}${i.due_on ? `, due ${spokenDay(i.due_on)}` : ""}`))}.`;
}
/** After one action, say what happened with no second AI call. null = let the AI word it. */
function speakResult(name, r) {
  if (r.error) return `That didn't work. ${r.error}`;
  switch (name) {
    case "add_task": return `Added "${r.added.title}"${r.added.due_on ? `, due ${spokenDay(r.added.due_on)}` : ""}.`;
    case "complete_task": return `Checked off "${r.completed}".`;
    case "add_calendar_event": return `Done. ${r.added.summary} is on your calendar ${spokenDay(r.added.day)}${r.added.when.includes("all day") ? ", all day" : ` at ${spokenTime(r.added.when)}`}.`;
    case "get_overview": return speakOverview(r);
    default: return null;
  }
}

// ------------------------------------------------------------------- actions
async function runTool(supabase, userId, name, a) {
  const today = todayInAustin();
  switch (name) {
    case "get_overview": {
      const [cal, tasks, caps] = await Promise.all([
        eventsBetween(supabase, userId, today, 1),
        supabase.from("tasks").select("title, due_on").eq("user_id", userId).neq("status", "done")
          .order("due_on", { nullsFirst: false }).limit(30),
        supabase.from("captures").select("kind, title, body, due_on, captured_at").eq("user_id", userId)
          .is("done_at", null).in("kind", ["followup", "thought"]).order("captured_at", { ascending: false }).limit(30),
      ]);
      const open = tasks.data ?? [];
      return {
        today,
        meetings: cal.ok ? cal.events.map((e) => ({ summary: e.summary, at: e.allDay ? "all day" : clockTime(e.start),
          over: !e.allDay && new Date(e.end ?? e.start) < new Date() }))
                         : `calendar unavailable: ${cal.message}`,
        tasks_overdue: open.filter((x) => x.due_on && x.due_on < today).map((x) => x.title),
        tasks_due_today: open.filter((x) => x.due_on === today).map((x) => x.title),
        open_tasks_total: open.length,
        followups_due: (caps.data ?? []).filter((c) => c.kind === "followup" && c.due_on && c.due_on <= today).map((c) => c.title || c.body),
        thoughts_this_week: (caps.data ?? []).filter((c) => c.kind === "thought" && c.captured_at > addDays(today, -7)).length,
      };
    }
    case "list_tasks": {
      const { data, error } = await supabase.from("tasks").select("id, title, due_on, priority")
        .eq("user_id", userId).neq("status", "done").order("priority").limit(50);
      return error ? { error: error.message } : { tasks: data };
    }
    case "add_task": {
      const title = String(a.title ?? "").trim().slice(0, 300);
      if (!title) return { error: "A task needs a title." };
      const due_on = /^\d{4}-\d{2}-\d{2}$/.test(a.due_on ?? "") ? a.due_on : null;
      const { data: task, error } = await supabase.from("tasks")
        .insert({ user_id: userId, title, due_on, priority: 3 }).select("id, title, due_on").single();
      if (error) return { error: error.message };
      // Mirror it into Pocket so it shows in the app's list too.
      await supabase.from("captures").insert({ id: randomUUID(), user_id: userId, body: title, title, kind: "task",
        due_on, task_id: task.id, ai_status: "done", ai_note: "Added by Jarvis", captured_at: new Date().toISOString() });
      return { added: task };
    }
    case "complete_task": {
      const now = new Date().toISOString();
      const { data, error } = await supabase.from("tasks").update({ status: "done", done_at: now })
        .eq("id", String(a.task_id)).eq("user_id", userId).select("title").maybeSingle();
      if (error || !data) return { error: error?.message ?? "No task with that id." };
      await supabase.from("captures").update({ done_at: now }).eq("task_id", String(a.task_id)).eq("user_id", userId);
      return { completed: data.title };
    }
    case "list_calendar": {
      const start = /^\d{4}-\d{2}-\d{2}$/.test(a.start_date ?? "") ? a.start_date : today;
      const r = await eventsBetween(supabase, userId, start, Math.min(14, Math.max(1, Number(a.days) || 1)));
      // `day` and `over` are spelled out so the model never has to work out a weekday.
      return r.ok ? { now: nowInAustin(), events: r.events.map((e) => ({ id: e.id, summary: e.summary,
        when: e.allDay ? `${e.start} all day` : `${e.start.slice(0, 10)} ${clockTime(e.start)}`,
        day: spokenDay(e.start.slice(0, 10)), over: !e.allDay && new Date(e.end ?? e.start) < new Date() })) } : { error: r.message };
    }
    case "add_calendar_event": {
      const title = String(a.title ?? "").trim().slice(0, 200);
      if (!title) return { error: "An event needs a title." };
      const allDay = /^\d{4}-\d{2}-\d{2}$/.test(a.all_day_date ?? "") ? a.all_day_date : null;
      const start = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(a.start ?? "") ? a.start : null;
      if (!allDay && !start) return { error: "I need a day and a time, or a day for an all-day event." };
      const r = await addEvent(supabase, userId, { title, start, allDayDate: allDay,
        minutes: Math.min(600, Math.max(5, Number(a.minutes) || 30)) });
      return r.ok ? { added: { summary: r.event.summary, day: r.event.start.slice(0, 10),
        when: r.event.allDay ? `${r.event.start} all day` : clockTime(r.event.start) } }
                  : { error: r.message };
    }
    case "list_captures": {
      const kind = ["followup", "note", "thought"].includes(a.kind) ? a.kind : "followup";
      const { data, error } = await supabase.from("captures").select("title, body, due_on, captured_at")
        .eq("user_id", userId).eq("kind", kind).is("done_at", null).order("captured_at", { ascending: false }).limit(10);
      return error ? { error: error.message } : { items: data.map((c) => ({ text: c.title || c.body, due_on: c.due_on })) };
    }
    default:
      return { error: `No action named ${name}.` };
  }
}

/** Look up exactly what would be deleted, then ask. Nothing is deleted here. */
async function askToDelete(supabase, userId, name, a) {
  if (name === "delete_task") {
    const { data } = await supabase.from("tasks").select("id, title").eq("id", String(a.task_id)).eq("user_id", userId).maybeSingle();
    if (!data) return say("I couldn't find that task, so nothing changed.");
    await setState(supabase, userId, "confirm", { kind: "task", id: data.id, label: data.title });
    return say(`Just to be sure, remove "${data.title}" from your list?`, true);
  }
  const r = await getEvent(supabase, userId, String(a.event_id));
  if (!r.ok) return say(`I couldn't find that event. ${r.message}`);
  const when = r.event.allDay ? "all day" : `at ${spokenTime(clockTime(r.event.start))}`;
  const day = new Date(r.event.allDay ? `${r.event.start}T12:00:00Z` : r.event.start)
    .toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: r.event.allDay ? "UTC" : TZ });
  const label = `${r.event.summary} on ${day} ${when}`;
  await setState(supabase, userId, "confirm", { kind: "event", id: r.event.id, label });
  return say(`Just to be sure, delete ${label}?`, true);
}

async function runDelete(supabase, userId, p) {
  if (p?.kind === "task") {
    await supabase.from("captures").delete().eq("task_id", p.id).eq("user_id", userId);
    const { error } = await supabase.from("tasks").delete().eq("id", p.id).eq("user_id", userId);
    return say(error ? `That didn't work: ${error.message}` : `Done. "${p.label}" is off your list.`);
  }
  if (p?.kind === "event") {
    const r = await deleteEvent(supabase, userId, p.id);
    return say(r.ok ? `Done. I deleted ${p.label}.` : `That didn't work. ${r.message}`);
  }
  return say("I lost track of what to delete, so nothing changed.");
}

// --------------------------------------------------------------- the AI loop
async function agent(supabase, userId, command, ctx, timing) {
  const messages = [{ role: "system", content: systemPrompt(ctx) }, { role: "user", content: command }];
  const used = [];
  try {
    // Usually one round: pick the action, run it, say the result from code.
    // A second round only when the AI has to read a result to answer.
    for (let round = 0; round < 3; round++) {
      const r = await complete(messages, { maxTokens: 600, tools: TOOLS, models: JARVIS_MODELS, timeoutMs: 12_000 });
      timing.ai.push({ model: r.model, ms: r.ms });
      const calls = r.message.tool_calls ?? [];
      if (!calls.length) {
        const text = (r.message.content ?? "").trim();
        // Busy free models sometimes type a tool call out as text instead of making it.
        if (/^[{\[]/.test(text) && /"(tool|name|function)"/.test(text)) {
          return { ...say("The AI answered in a broken format, so nothing changed. Please say it again."), used };
        }
        // He asked for a change and no action ran: never let the AI claim "done".
        if (round === 0 && WRITES.test(command)) {
          return { ...say("I didn't change anything that time. Please say it again."), used, error: "write request, no action" };
        }
        return { ...say(spoken(text) || "Done."), used };
      }
      messages.push({ role: "assistant", content: r.message.content ?? null, tool_calls: calls });
      const spoken = [];
      for (const call of calls) {
        let a = {};
        try { a = JSON.parse(call.function.arguments || "{}"); } catch { /* run with no input */ }
        const name = call.function.name;
        used.push(name);
        if (name === "delete_task" || name === "delete_calendar_event") {
          return { ...(await askToDelete(supabase, userId, name, a)), used };
        }
        const result = await runTool(supabase, userId, name, a);
        spoken.push(speakResult(name, result));
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
      // Every action had a plain result to report: done, no second AI call.
      if (spoken.every(Boolean)) return { ...say(spoken.join(" ")), used };
    }
    return { ...say("That took more steps than I allow at once. Try asking one thing at a time."), used };
  } catch (e) {
    await logCall(supabase, userId, "openrouter", false, null, `[pocket] Jarvis: ${e.message}`);
    return { ...say(/busy|Rate limit/i.test(e.message)
      ? "The free AI is out of requests or busy right now. Your thoughts still save, but commands need to wait."
      : "Something went wrong reaching the AI. Nothing changed."), used, error: e.message };
  }
}
