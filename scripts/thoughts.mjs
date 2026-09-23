// Read Daniel's Thoughts from a Claude Code session on the laptop, and write a
// deeper review back so it shows in the app under "Claude's review".
//
//   npm run thoughts                     thoughts with no review yet
//   npm run thoughts -- all              every thought
//   npm run thoughts -- review <id> <file-with-review-text>
//
// Uses the Supabase secret key from .env.local, so it only works on this laptop.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const [cmd, id, file] = process.argv.slice(2);

if (cmd === "review") {
  if (!id || !file) throw new Error("Usage: npm run thoughts -- review <id> <file>");
  const review = readFileSync(file, "utf8").trim();
  const { data, error } = await sb.from("captures").update({ review }).eq("id", id).eq("kind", "thought").select("id").maybeSingle();
  if (error || !data) throw new Error(error?.message ?? `No thought with id ${id}.`);
  console.log(`Review saved on ${id}. It shows in Pocket under the thought.`);
} else {
  let q = sb.from("captures").select("id, body, title, feedback, review, captured_at")
    .eq("kind", "thought").order("captured_at", { ascending: false }).limit(50);
  if (cmd !== "all") q = q.is("review", null);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  if (!data.length) console.log("No thoughts waiting for a review.");
  for (const t of data) {
    console.log(`\n=== ${t.id}  (${t.captured_at.slice(0, 10)})`);
    console.log(`Thought: ${t.body}`);
    if (t.feedback) console.log(`AI take: ${t.feedback.verdict}. ${t.feedback.summary}\nAI first steps: ${t.feedback.first_steps.join(" / ")}`);
    if (t.review) console.log(`Claude's review: ${t.review}`);
  }
}
