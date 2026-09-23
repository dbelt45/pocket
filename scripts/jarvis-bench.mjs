// Jarvis speed bench. Measures how long Jarvis takes to answer, and whether he
// picked the right action. Part of the jarvis-tune skill (.claude/skills/jarvis-tune).
//
//   npm run bench -- live   [--runs 2] [--url https://...]   the deployed app, end to end
//   npm run bench -- local  [--runs 2]                        this laptop's code, same database
//   npm run bench -- models [--runs 2] [--models a,b]         which free model picks actions fastest
//   npm run bench -- real   [--days 7]                        how fast Jarvis was in real use
//
// live and local only send READ-ONLY phrases, so a bench never adds, completes
// or deletes anything. models mode sends write phrases too, but only asks the
// model which action it WOULD take; nothing is run.
//
// Secrets: reads .env.local, never prints a key or a token. It signs in by
// minting a one-time link with the Supabase secret key, the same way an email
// link works, so it can only ever act as Daniel on Daniel's own rows.
import { appendFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const mode = args[0] ?? "live";
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i > -1 ? args[i + 1] : d; };
const RUNS = Number(opt("runs", 2));
const URL_ = opt("url", "https://pocket-nine-coral.vercel.app");
const PACE = Number(opt("pace", 3500)); // ms between model calls
const E = process.env;

// Read-only phrases: safe to run against the real account any number of times.
export const READ = [
  { text: "What's on today?", want: ["get_overview"] },
  { text: "What's on my calendar tomorrow?", want: ["list_calendar"] },
  { text: "Read me my to-do list", want: ["list_tasks"] },
  { text: "What follow-ups do I have?", want: ["list_captures"] },
  { text: "How many meetings do I have this week?", want: ["list_calendar"] },
  // Not a quick answer: keeps the AI path in every bench, so a crash there shows up.
  { text: "Which of my tasks is the most overdue?", want: ["list_tasks"] },
];
// Write phrases: models mode only (the action is chosen, never run). `args`
// checks the details too: a right action with the wrong day is still wrong.
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const plus = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const friday = plus((5 - new Date(`${today}T12:00:00Z`).getUTCDay() + 7) % 7 || 7);
const WRITE = [
  { text: "Add a task to call the pastor Friday", want: ["add_task"], args: (a) => a.due_on === friday && /pastor/i.test(a.title) },
  { text: "Put lunch with Tim on my calendar tomorrow at noon for an hour", want: ["add_calendar_event"],
    args: (a) => a.start === `${plus(1)}T12:00` && Number(a.minutes) === 60 },
  { text: "Check off the Vercel task", want: ["complete_task"], args: (a) => a.task_id === "t1" },
  { text: "Take the Day 3 report task off my list", want: ["delete_task"], args: (a) => a.task_id === "t2" },
];

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
const p90 = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.ceil(s.length * 0.9) - 1] : 0; };
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

async function asDaniel() {
  const admin = createClient(E.SUPABASE_URL, E.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const { data: t } = await admin.from("integration_tokens").select("user_id").eq("provider", "google").single();
  const email = (await admin.auth.admin.getUserById(t.user_id)).data.user.email;
  const link = (await admin.auth.admin.generateLink({ type: "magiclink", email })).data.properties.action_link;
  const pub = createClient(E.SUPABASE_URL, E.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await pub.auth.verifyOtp({ token_hash: link.match(/token=([^&]+)/)[1], type: "magiclink" });
  if (error) throw error;
  return { admin, userId: t.user_id, jwt: data.session.access_token };
}

function report(label, rows) {
  const ms = rows.map((r) => r.ms);
  const right = rows.filter((r) => r.ok).length;
  console.log(`\n${label}: median ${secs(med(ms))}, p90 ${secs(p90(ms))}, right action ${right}/${rows.length}`);
  appendFileSync("docs/jarvis-speed-log.md",
    `| ${new Date().toISOString().slice(0, 16)} | ${label} | ${secs(med(ms))} | ${secs(p90(ms))} | ${right}/${rows.length} |\n`);
}

if (mode === "live" || mode === "local") {
  const me = await asDaniel();
  const { handle } = mode === "local" ? await import("../api/_lib/jarvis.js") : {};
  const rows = [];
  for (let run = 0; run < RUNS; run++) {
    for (const p of READ) {
      const t0 = Date.now();
      let r;
      if (mode === "live") {
        r = await fetch(`${URL_}/api/jarvis`, { method: "POST",
          headers: { authorization: `Bearer ${me.jwt}`, "content-type": "application/json" },
          body: JSON.stringify({ text: p.text }) }).then((x) => x.json());
      } else {
        r = await handle(me.admin, me.userId, p.text);
      }
      const ms = Date.now() - t0;
      const used = r.used ?? r.timing?.used ?? [];
      const ok = !r.error && r.ok !== false && (used.length === 0 || used.some((u) => p.want.includes(u)));
      rows.push({ ms, ok });
      const where = r.timing ? ` [${r.timing.path}${r.timing.ai?.length ? `, ${r.timing.ai.map((a) => `${a.model.split("/")[1]} ${secs(a.ms)}`).join(" + ")}` : ""}]` : "";
      console.log(`${secs(ms).padStart(6)}  ${p.text}${where}\n        -> ${String(r.say).slice(0, 110)}`);
    }
  }
  report(`${mode}${mode === "live" ? "" : " (laptop)"}`, rows);
} else if (mode === "models") {
  const { systemPrompt, TOOLS } = await import("../api/_lib/jarvis.js");
  const { complete, JARVIS_MODELS } = await import("../api/_lib/ai.js");
  const models = opt("models", "") ? opt("models").split(",") : JARVIS_MODELS;
  const system = systemPrompt({ tasks: [{ id: "t1", title: "Set up Vercel for Pocket" }, { id: "t2", title: "Send Ricky the Day 3 report" }] });
  for (const model of models) {
    const rows = [];
    for (let run = 0; run < RUNS; run++) {
      for (const p of [...READ, ...WRITE]) {
        // Free models allow about 20 requests a minute in total. Stay under it,
        // or the bench measures the rate limit instead of the model.
        await new Promise((r) => setTimeout(r, PACE));
        const t0 = Date.now();
        try {
          const { message } = await complete([{ role: "system", content: system }, { role: "user", content: p.text }],
            { tools: TOOLS, maxTokens: 400, models: [model], timeoutMs: 20000 });
          const calls = message.tool_calls ?? [];
          const hit = calls.find((c) => p.want.includes(c.function.name));
          let a = {}; try { a = JSON.parse(hit?.function.arguments || "{}"); } catch { /* bad args */ }
          // The task list is in the prompt, so reading it back with no action is right too.
          const readBack = !calls.length && p.want.includes("list_tasks") && !!message.content?.trim();
          const ok = readBack || (!!hit && (!p.args || p.args(a)));
          rows.push({ ms: Date.now() - t0, ok });
          if (!ok) console.log(`   miss: "${p.text}" -> ${calls.map((c) => `${c.function.name}(${c.function.arguments})`).join(", ") || JSON.stringify(message.content).slice(0, 80)}`);
        } catch (e) {
          // A rate limit says nothing about the model: wait it out, do not count it.
          if (/Rate limit/i.test(e.message)) { console.log("   rate limited, waiting 30s"); await new Promise((r) => setTimeout(r, 30_000)); continue; }
          rows.push({ ms: Date.now() - t0, ok: false });
          console.log(`   ${model}: ${e.message.slice(0, 100)}`);
        }
      }
    }
    report(`model ${model}`, rows);
  }
} else if (mode === "real") {
  // How fast Jarvis was for Daniel himself, from the timing each reply records
  // in the events table (no words are stored there, only path and times).
  const me = await asDaniel();
  const since = new Date(Date.now() - Number(opt("days", 7)) * 864e5).toISOString();
  const { data, error } = await me.admin.from("events").select("meta, created_at").eq("user_id", me.userId)
    .eq("name", "pocket:jarvis").gte("created_at", since).order("created_at");
  if (error) throw error;
  const timed = data.filter((e) => e.meta?.ms != null);
  console.log(`${data.length} Jarvis requests since ${since.slice(0, 10)}, ${timed.length} with timing.`);
  const by = {};
  for (const e of timed) (by[e.meta.path ?? "?"] ??= []).push(e.meta.ms);
  for (const [path, ms] of Object.entries(by)) console.log(`  ${path.padEnd(8)} ${String(ms.length).padStart(4)} requests  median ${secs(med(ms))}  p90 ${secs(p90(ms))}`);
  const failed = data.filter((e) => e.meta?.failed).length;
  if (failed) console.log(`  ${failed} failed (see integration_log, provider openrouter)`);
  if (timed.length) report(`real use, last ${opt("days", 7)} days`, timed.map((e) => ({ ms: e.meta.ms, ok: !e.meta.failed })));
} else {
  console.log("Usage: npm run bench -- live|local|models|real [--runs N] [--models a,b] [--url URL] [--days N]");
}
