// The AI feature: read a batch of rough notes and sort each one.
// Same free OpenRouter models and the same fallback logic as Daniel OS
// (daniel-os/lib/ai.ts), so both apps behave the same way when a model is busy.

export const MODELS = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "google/gemma-4-31b-it:free",
];

export const KINDS = ["task", "followup", "note"];

/** One chat completion. Walks the model list; throws only when all of them fail. */
export async function complete(messages, maxTokens) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set.");
  const failures = [];
  for (let i = 0; i < MODELS.length; i++) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY.trim()}`,
          "Content-Type": "application/json",
          "X-Title": "pocket",
        },
        body: JSON.stringify({
          models: MODELS.slice(i),
          messages,
          reasoning: { exclude: true },
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(25_000),
      });
      const body = await res.json().catch(() => ({}));
      const choice = body.choices?.[0];
      const error = body.error?.message ?? choice?.error?.message;
      if (res.status === 401) throw new Error("OpenRouter rejected the key (401).");
      if (!res.ok) { failures.push(`${MODELS[i]}: ${error ?? `HTTP ${res.status}`}`); break; }
      if (error || !choice?.message?.content) {
        // A 200 reply hiding an error. Skip past whichever model sent it.
        failures.push(`${body.model ?? MODELS[i]}: ${error ?? "empty reply"}`);
        i = Math.max(i, MODELS.indexOf(body.model));
        continue;
      }
      return { text: choice.message.content, model: String(body.model ?? MODELS[i]) };
    } catch (e) {
      if (e.message?.startsWith("OpenRouter rejected")) throw e;
      failures.push(`${MODELS[i]}: ${e.message ?? "request failed"}`);
    }
  }
  throw new Error(`Every free model is busy right now. ${failures.join(" | ")}`);
}

export function sortPrompt(captures, today) {
  const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  return [
    {
      role: "system",
      content: `You sort quick notes that Daniel Belt typed or dictated on his phone. Daniel is
Director of Operations at Turnkey Services. Today is ${weekday}, ${today}, in Austin, Texas.

For each note decide:
- kind: "task" if Daniel himself has to do something. "followup" if it is about getting
  back to a specific person, or waiting to hear from someone. "note" if it is an idea or
  information to keep, with no action.
- title: a short clear line, under 80 characters. For a task or followup start with a verb.
  Never use an em dash or an en dash.
- due_on: a date as YYYY-MM-DD only when the note says or clearly implies one. "tomorrow" is
  the day after today. A weekday name means the next one after today. "next week" means next
  Monday. Otherwise null. Never guess a date the note does not support.

Reply with JSON only, no other text, in exactly this shape:
{"items":[{"id":"<the id you were given>","kind":"task","title":"...","due_on":null}]}`,
    },
    { role: "user", content: JSON.stringify(captures.map((c) => ({ id: c.id, note: c.body }))) },
  ];
}

/**
 * Turn the model's reply into trusted rows. The model's output is treated as
 * untrusted input: anything with an unknown id, a made-up kind or a malformed
 * date is dropped here, and the caller marks that capture as failed.
 */
export function parseSort(text, ids) {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return [];
  let items;
  try { items = JSON.parse(json).items; } catch { return []; }
  if (!Array.isArray(items)) return [];
  const wanted = new Set(ids);
  const out = [];
  for (const it of items) {
    if (!wanted.has(it?.id) || !KINDS.includes(it.kind)) continue;
    const title = String(it.title ?? "").replace(/[–—]/g, "-").trim().slice(0, 120);
    if (!title) continue;
    const due = /^\d{4}-\d{2}-\d{2}$/.test(it.due_on ?? "") && !isNaN(Date.parse(it.due_on)) ? it.due_on : null;
    out.push({ id: it.id, kind: it.kind, title, due_on: due });
    wanted.delete(it.id); // first answer per id wins
  }
  return out;
}
