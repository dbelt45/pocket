import { randomUUID } from "node:crypto";
import { complete, giveFeedback } from "./ai.js";
import { TZ, todayInAustin, logCall } from "./supabase.js";
import { eventsBetween, addEvent, getEvent, deleteEvent, addDays } from "./calendar.js";

// Jarvis: turns one spoken sentence into an answer, and sometimes an action.
//
// How a sentence is handled, in order:
// 1. Is Jarvis waiting on something? ("What are you thinking?" or "delete X?")
//    Then this sentence is the answer to that question.
// 2. Does it start with "Jarvis, I have a thought"? Then it is a thought.
//    This is plain pattern matching, no AI, so it always works and costs nothing.
// 3. Anything else goes to the AI model with the list of actions below. The
//    model can only do what this list allows, and the code runs each action.
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
- One to three short sentences. No lists, no markdown, no emoji, no URLs.
- Say times the way a person would: "two thirty", "ten in the morning".
- Answer first. Never recap what you looked up.
- Never use an em dash or an en dash.
- Only state what an action returned. Never invent a task, a meeting or a number.
- If an action fails, say so plainly and say what it said.
- To remove a task or a calendar event, call the delete action. Daniel is asked to
  confirm automatically, so do not ask him yourself.
- "My to-do list" means his tasks. "Remove" or "take off" a task means delete it.
  "Done", "finished" or "check off" means complete it.`;

const fn = (name, description, properties = {}, required = []) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
});

export const TOOLS = [
  fn("get_overview", "A spoken summary of Daniel's day: today's meetings, tasks due or overdue, follow-ups due, and recent thoughts. Use for 'what's on today', 'summarize my day', 'what do I need to know'."),
  fn("list_tasks", "Daniel's open to-do list, with ids. Call before completing or deleting a task."),
  fn("add_task", "Add a task to Daniel's to-do list.", {
    title: { type: "string", description: "The task, short, starting with a verb." },
    due_on: { type: "string", description: "YYYY-MM-DD, only if he gave a day." },
  }, ["title"]),
  fn("complete_task", "Mark a task done. Needs the id from list_tasks.", { task_id: { type: "string" } }, ["task_id"]),
  fn("delete_task", "Remove a task from the list entirely. Needs the id from list_tasks. Daniel will be asked to confirm.",
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
  fn("delete_calendar_event", "Remove an event from Google Calendar. Needs the id from list_calendar. Daniel will be asked to confirm.",
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
export async function handle(supabase, userId, rawText) {
  const text = String(rawText ?? "").trim().slice(0, 4000);
  if (!text) return say("I didn't catch that.");

  const state = await getState(supabase, userId);
  if (state) await clearState(supabase, userId);

  if (state?.awaiting === "thought") return saveThought(supabase, userId, text.replace(WAKE, ""));
  if (state?.awaiting === "confirm") {
    if (!YES.test(text)) return say("Okay, I left it alone.");
    return runDelete(supabase, userId, state.payload);
  }

  const t = text.match(THOUGHT);
  if (t) {
    const rest = text.slice(t[0].length).trim();
    // "Jarvis, I have a thought, what if..." said in one breath: save it now.
    if (rest.split(/\s+/).length >= 4) return saveThought(supabase, userId, rest);
    await setState(supabase, userId, "thought");
    return say("What are you thinking?", true);
  }

  return agent(supabase, userId, text.replace(WAKE, "") || text);
}

// ---------------------------------------------------------------- thoughts
async function saveThought(supabase, userId, body) {
  const row = { id: randomUUID(), user_id: userId, body, kind: "thought", ai_status: "done",
    ai_note: "Saved by Jarvis", captured_at: new Date().toISOString() };
  const { error } = await supabase.from("captures").insert(row);
  if (error) return say(`I couldn't save that thought. The database said: ${error.message}`);
  const log = (ok, status, msg) => logCall(supabase, userId, "openrouter", ok, status, `[pocket] ${msg}`);
  const fb = await giveFeedback(supabase, userId, row, todayInAustin(), log);
  return say(fb
    ? `Saved to Thoughts. Quick take: ${fb.summary} The full feedback is in the app.`
    : "Saved to Thoughts. I'll add feedback when the AI is free.");
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
        meetings: cal.ok ? cal.events.map((e) => ({ summary: e.summary, at: e.allDay ? "all day" : clockTime(e.start) }))
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
      return r.ok ? { events: r.events.map((e) => ({ id: e.id, summary: e.summary,
        when: e.allDay ? `${e.start} all day` : `${e.start.slice(0, 10)} ${clockTime(e.start)}` })) } : { error: r.message };
    }
    case "add_calendar_event": {
      const title = String(a.title ?? "").trim().slice(0, 200);
      if (!title) return { error: "An event needs a title." };
      const allDay = /^\d{4}-\d{2}-\d{2}$/.test(a.all_day_date ?? "") ? a.all_day_date : null;
      const start = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(a.start ?? "") ? a.start : null;
      if (!allDay && !start) return { error: "I need a day and a time, or a day for an all-day event." };
      const r = await addEvent(supabase, userId, { title, start, allDayDate: allDay,
        minutes: Math.min(600, Math.max(5, Number(a.minutes) || 30)) });
      return r.ok ? { added: { summary: r.event.summary, when: r.event.allDay ? `${r.event.start} all day` : clockTime(r.event.start) } }
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
  const when = r.event.allDay ? "all day" : `at ${clockTime(r.event.start)}`;
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
async function agent(supabase, userId, command) {
  const messages = [
    { role: "system", content: `${SPOKEN}\n\nRight now it is ${nowInAustin()} in Austin, Texas. Today's date is ${todayInAustin()}.` },
    { role: "user", content: command },
  ];
  const used = [];
  try {
    // Four rounds covers "what's on my list, check off the first one".
    for (let round = 0; round < 4; round++) {
      const { message } = await complete(messages, { maxTokens: 2000, tools: TOOLS });
      const calls = message.tool_calls ?? [];
      if (!calls.length) {
        const text = (message.content ?? "").trim();
        // Busy free models sometimes type a tool call out as text instead of making it.
        if (/^[{\[]/.test(text) && /"(tool|name|function)"/.test(text)) {
          return { ...say("The AI answered in a broken format, so nothing changed. Please say it again."), used };
        }
        return { ...say(text || "Done."), used };
      }
      messages.push({ role: "assistant", content: message.content ?? null, tool_calls: calls });
      for (const call of calls) {
        let a = {};
        try { a = JSON.parse(call.function.arguments || "{}"); } catch { /* run with no input */ }
        used.push(call.function.name);
        if (call.function.name === "delete_task" || call.function.name === "delete_calendar_event") {
          return { ...(await askToDelete(supabase, userId, call.function.name, a)), used };
        }
        messages.push({ role: "tool", tool_call_id: call.id,
          content: JSON.stringify(await runTool(supabase, userId, call.function.name, a)) });
      }
    }
    return { ...say("That took more steps than I allow at once. Try asking one thing at a time."), used };
  } catch (e) {
    await logCall(supabase, userId, "openrouter", false, null, `[pocket] Jarvis: ${e.message}`);
    return { ...say(/busy|Rate limit/i.test(e.message)
      ? "The free AI is out of requests or busy right now. Your thoughts still save, but commands need to wait."
      : "Something went wrong reaching the AI. Nothing changed."), used, error: e.message };
  }
}
