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
