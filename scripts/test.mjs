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
