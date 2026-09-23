// `npm run check` - which parts of Pocket are live, without ever printing a key.
import { createClient } from "@supabase/supabase-js";
import { complete, sortPrompt, parseSort } from "../api/_lib/ai.js";
import { todayInAustin } from "../api/_lib/supabase.js";

const line = (name, ok, note) => console.log(`${ok ? "WORKING " : "NOT YET "} ${name.padEnd(18)} ${note}`);
const need = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "OPENROUTER_API_KEY",
  "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "CRON_SECRET"];
const missing = need.filter((k) => !process.env[k]);
line("Settings", !missing.length, missing.length ? `missing: ${missing.join(", ")}` : "all 10 set");

// Tables: the publishable key sees zero rows (row-level security), but a
// missing table is a different error, so this tells "not created" from "empty".
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY);
for (const t of ["captures", "push_subscriptions", "jarvis_state", "jarvis_tokens"]) {
  const { error } = await sb.from(t).select("*").limit(1);
  line(`Table ${t}`, !error, !error ? "exists" : error.code === "PGRST205" ? "not created yet - run supabase/schema.sql" : error.message);
}

const notes = [
  { id: "1", body: "email the pastor at grace fellowship about the partner program friday" },
  { id: "2", body: "idea: short loom video explaining stewardwell to cpa firms" },
  { id: "3", body: "renew my vercel two factor tomorrow" },
];
try {
  const t0 = Date.now();
  const r = await complete(sortPrompt(notes, todayInAustin()), 4000);
  const out = parseSort(r.text, notes.map((n) => n.id));
  line("AI sorting", out.length === 3, `${out.length}/3 sorted by ${r.model} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const o of out) console.log(`           ${o.kind.padEnd(9)} ${o.due_on ?? "no date   "}  ${o.title}`);
} catch (e) { line("AI sorting", false, e.message); }
