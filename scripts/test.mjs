// The one piece of logic that must not break quietly: turning the AI's reply
// into rows we trust. `npm test`.
import assert from "node:assert/strict";
import { parseSort } from "../api/_lib/ai.js";

const ids = ["a", "b", "c"];
const reply = "```json\n" + JSON.stringify({ items: [
  { id: "a", kind: "task", title: `Send Ricky the Day 3 report ${String.fromCharCode(8212)} tonight`, due_on: "2026-09-22" },
  { id: "b", kind: "followup", title: "Call back the CPA firm", due_on: "Friday" },  // bad date
  { id: "x", kind: "task", title: "Invented by the model", due_on: null },         // unknown id
  { id: "c", kind: "reminder", title: "Made-up kind", due_on: null },              // bad kind
  { id: "a", kind: "note", title: "Duplicate answer", due_on: null },              // second answer for a
]}) + "\n```";

const out = parseSort(reply, ids);
assert.equal(out.length, 2);
assert.deepEqual(out[0], { id: "a", kind: "task", title: "Send Ricky the Day 3 report - tonight", due_on: "2026-09-22" });
assert.deepEqual(out[1], { id: "b", kind: "followup", title: "Call back the CPA firm", due_on: null });
assert.deepEqual(parseSort("sorry, I can't help", ids), []);
assert.deepEqual(parseSort('{"items": "nope"}', ids), []);
console.log("parseSort: all checks passed");

// The voice phrases. These decide whether Jarvis saves a thought, deletes
// something, or asks the AI, so a regression here changes behavior silently.
import { WAKE, THOUGHT, YES } from "../api/_lib/jarvis.js";
for (const s of ["Jarvis, I have a thought", "jarvis i have a thought", "Hey Jarvis, I've got an idea",
  "I have a thought.", "Jarvis I’ve got a thought"]) assert.ok(THOUGHT.test(s), `thought: ${s}`);
for (const s of ["Jarvis, add a task to call Tim", "what thoughts do I have", "I have a meeting at 3"])
  assert.ok(!THOUGHT.test(s), `not a thought: ${s}`);
const rest = (s) => s.slice(s.match(THOUGHT)[0].length).trim();
assert.equal(rest("Jarvis, I have a thought, what if Pocket texted me a summary"), "what if Pocket texted me a summary");
for (const s of ["Yes", "yeah do it", "Go ahead", "yes please"]) assert.ok(YES.test(s), `yes: ${s}`);
for (const s of ["no", "wait", "not that one", "yesterday's meeting"]) assert.ok(!YES.test(s), `not yes: ${s}`);
assert.equal("Jarvis, what's on today".replace(WAKE, ""), "what's on today");
assert.equal("Hey Jarvis what's on today".replace(WAKE, ""), "what's on today");
console.log("voice phrases: all checks passed");

// Quick answers: questions answered with no AI. A write must NEVER land here,
// because a quick answer only reads; "add" or "delete" has to reach the AI.
import { quickRoute, whichDays, speakTasks, speakEvents } from "../api/_lib/jarvis.js";
const wed = "2026-09-23"; // a Wednesday
const routes = {
  "What's on today?": "overview", "what's on my plate": "overview", "Summarize my day": "overview",
  "What's on my calendar tomorrow?": "calendar", "Do I have any meetings Friday?": "calendar",
  "How many meetings do I have this week?": "calendar", "what's my schedule next week": "calendar",
  "Read me my to-do list": "tasks", "what tasks do I have": "tasks",
  "What follow-ups do I have?": "followup", "read me my thoughts": "thought", "any notes?": "note",
  // must go to the AI
  "Add a task to call the pastor Friday": null, "Put lunch with Tim on my calendar tomorrow at noon": null,
  "Cancel my 3 o'clock": null, "Take the Vercel task off my list": null, "Check off the Vercel task": null,
  "What's on my calendar on October 3rd?": null, "remind me to call mom": null,
  "what tasks are due before my meeting tomorrow": null,
};
for (const [s, want] of Object.entries(routes)) assert.equal(quickRoute(s, wed), want, `route: ${s}`);
assert.deepEqual(whichDays("tomorrow", wed), { start: "2026-09-24", days: 1, label: "tomorrow" });
assert.deepEqual(whichDays("Friday", wed), { start: "2026-09-25", days: 1, label: "on Friday" });
assert.deepEqual(whichDays("this week", wed), { start: wed, days: 5, label: "this week" }); // Wed to Sun
assert.deepEqual(whichDays("next week", wed), { start: "2026-09-28", days: 7, label: "next week" });
assert.equal(whichDays("on October 3rd", wed), null);
assert.equal(speakTasks([], wed), "Your to-do list is empty.");
assert.equal(speakTasks([{ title: "A", due_on: "2026-09-01" }, { title: "B" }], wed), "You have 2 open tasks, 1 overdue: A and B.");
assert.equal(speakEvents({ events: [] }, { label: "tomorrow", days: 1 }), "Tomorrow your calendar is clear.");
assert.equal(speakEvents({ events: [{ summary: "TK", when: "2026-09-24 1:00 PM" }] }, { label: "tomorrow", days: 1 }), "Tomorrow you have one event: TK at 1 PM.");
console.log("quick answers: all checks passed");

// Spoken text: what the phone reads aloud must be one clean paragraph.
import { spoken } from "../api/_lib/jarvis.js";
const dash = String.fromCharCode(8212);
assert.equal(spoken(`The **most overdue** task ${dash} due Sept 20.\n\nAlso #2.`), "The most overdue task, due Sept 20. Also 2.");
assert.equal(spoken("Meet at 1 - bring notes"), "Meet at 1 - bring notes"); // a spaced hyphen is fine
assert.equal(spoken("Two are tied:\n1. Get apps\n2. Fix the dashboard. Costs 3.5 hours."), "Two are tied: Get apps Fix the dashboard. Costs 3.5 hours."); // list numbers are not read aloud
console.log("spoken text: all checks passed");

// The Slack message Jarvis sends to Ricky. It must always carry the signature.
import { slackText, SIGNATURE } from "../api/_lib/slack.js";
assert.equal(slackText("followup", [{ text: "Call Tim", due_on: "2026-09-26" }, { text: "Email Brandi" }]),
  `*Follow-ups*\n• Call Tim (due 2026-09-26)\n• Email Brandi\n\n${SIGNATURE}`);
assert.equal(slackText(null, [], "Running 10 late"), `Running 10 late\n\n${SIGNATURE}`);
assert.ok(YES.test("send it") && YES.test("Yes"));
console.log("slack message: all checks passed");
