import { asUser, unauthorized, logCall, todayInAustin } from "./_lib/supabase.js";
import { complete, sortPrompt, parseSort } from "./_lib/ai.js";

// POST /api/sort - the AI feature. Takes every capture still waiting to be
// sorted, asks the model to sort them all in ONE request (the free tier allows
// about 50 requests a day, so one per capture would run out), and saves the
// result. A capture sorted as a task is also copied into the Daniel OS task list.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  const who = await asUser(req);
  if (!who) return unauthorized(res);
  const { supabase, user } = who;

  const { data: pending, error } = await supabase.from("captures")
    .select("id, body").eq("ai_status", "pending").order("captured_at").limit(10);
  if (error) return res.status(500).json({ ok: false, message: error.message });
  if (!pending.length) return res.status(200).json({ ok: true, sorted: 0 });

  let sorted, model;
  try {
    const reply = await complete(sortPrompt(pending, todayInAustin()), 4000);
    model = reply.model;
    sorted = parseSort(reply.text, pending.map((p) => p.id));
  } catch (e) {
    // The notes stay saved and stay "pending", so the next open tries again.
    await logCall(supabase, user.id, "openrouter", false, null, `[pocket] ${e.message}`);
    return res.status(503).json({ ok: false, message: e.message });
  }

  for (const s of sorted) {
    let task_id = null;
    if (s.kind === "task") {
      const { data: t } = await supabase.from("tasks")
        .insert({ user_id: user.id, title: s.title, due_on: s.due_on, priority: 3 })
        .select("id").single();
      task_id = t?.id ?? null;
    }
    await supabase.from("captures").update({
      kind: s.kind, title: s.title, due_on: s.due_on, task_id,
      ai_status: "done", ai_note: `Sorted by ${model}`,
    }).eq("id", s.id).eq("ai_status", "pending"); // never re-sort one twice
  }

  // Anything the model skipped or answered with junk is marked failed, visibly.
  const missed = pending.filter((p) => !sorted.some((s) => s.id === p.id)).map((p) => p.id);
  if (missed.length) {
    await supabase.from("captures").update({ ai_status: "failed", ai_note: "The AI reply did not include a usable answer for this one." })
      .in("id", missed);
  }
  await logCall(supabase, user.id, "openrouter", missed.length === 0, 200,
    `[pocket] Sorted ${sorted.length} of ${pending.length} with ${model}.`);
  return res.status(200).json({ ok: true, sorted: sorted.length, failed: missed.length });
}
