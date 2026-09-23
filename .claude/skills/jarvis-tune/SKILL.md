---
name: jarvis-tune
description: Make Jarvis (the voice assistant in Daniel's Pocket app) faster and better at answering. Use when Daniel says Jarvis is slow, got something wrong, misheard, said something odd, or asks to tune, test, benchmark or improve Jarvis, or to check how Jarvis has been doing.
---

# jarvis-tune

One job: make Jarvis answer faster and answer better. Nothing else. It measures
first, changes one thing, proves the change with numbers, and ships it only if
nothing got worse.

Everything lives in the Pocket repo (`labs/daniel-ai-sprint/pocket`, GitHub
`dbelt45/pocket`, live at https://pocket-nine-coral.vercel.app). A push to `main`
deploys it.

## Hard rules (never bend these for speed)

| Rule | Why |
|---|---|
| **Free OpenRouter models only** (ids ending `:free`). No paid model, no new AI provider, no new spend without Daniel's yes | Ricky directive: sprint AI runs on free models. OpenRouter reports this key as not free tier (checked 2026-09-23 at `https://openrouter.ai/api/v1/key`), which allows 1,000 free-model requests a day. Any credit on the account is not to be spent |
| **Secrets stay in `.env.local` and Vercel.** Never print, log, commit or paste a key, token or sign-in code. The bench prints none | The repo is public |
| **Deletes always ask first**, and "yes" stays a plain pattern (`YES` in `api/_lib/jarvis.js`), never an AI decision | Speech gets misheard. A misheard word must never delete a meeting |
| **Quick answers only ever read.** `quickRoute()` returns null for anything that adds, changes or removes. `npm test` enforces it | A fast path that writes would skip the AI's checks and the confirm step |
| **Every query filters by `user_id`.** Siri requests use the Supabase secret key, which skips row security, so the filter is the only guard | One missing filter exposes or changes someone else's rows |
| **Accuracy never drops.** A change ships only if `npm test` passes and the bench's "right action" count is the same or better | Fast and wrong is worse than slow |
| **Live bench is read-only.** Write phrases are only tested in `models` mode, where the action is chosen but never run | The bench runs against Daniel's real calendar and task list |
| **Stay under the free rate limit** (about 20 requests a minute across all free models). The bench paces itself; never run two model benches at once | Otherwise the bench measures the limit, and Jarvis stops working for Daniel meanwhile |
| No em or en dashes in anything Jarvis says or in this repo | Workspace rule |
| Never touch Turnkey's workspace `.env`, client systems or client books | Sprint projects use Daniel's own accounts only |

## How Jarvis answers (know this before changing it)

`api/jarvis.js` receives one sentence and calls `handle()` in `api/_lib/jarvis.js`:

1. **Prefetch, in parallel:** the waiting state (a pending "What are you thinking?"
   or "delete X?"), his open tasks with ids, and, only when the sentence is about
   changing the calendar, the next 14 days of events with ids.
2. **Waiting for an answer?** Save the thought, or run the delete on a plain "yes".
3. **"Jarvis, I have a thought"?** Pattern match, no AI. The thought is saved at
   once; the AI feedback runs after the reply is sent (`later` plus `waitUntil`).
4. **Quick answer?** `quickRoute()` recognizes plain questions about the day,
   calendar, tasks, follow-ups, notes and thoughts. Answered straight from the
   data by the `speak*` functions. No AI. Under a second.
5. **Otherwise the AI**, with the task list (and events when relevant) already
   in the prompt, so it acts in one call. After a simple action, `speakResult()`
   words the reply in code, so there is no second AI call.

Every reply carries `timing` (`path`, `ms`, `db_ms`, each AI call's model and ms),
and `api/jarvis.js` stores path and times (never the words) in `events.meta` for
`pocket:jarvis`.

## The loop

1. **Measure.** `npm run bench -- real` (Daniel's real use, last 7 days) and
   `npm run bench -- live` (the deployed app, read-only phrases). Note the median,
   the slowest 10%, and which `path` is slow.
2. **Find the slow part** from `timing`: AI time (model or prompt), `db_ms`
   (Supabase or Google), or the path (a question that should be quick went to the AI).
3. **Change one thing.** Pick from the levers below.
4. **Prove it on the laptop:** `npm test`, then `npm run bench -- local`. For a
   model or prompt change, `npm run bench -- models --models <ids>`.
5. **Ship:** commit, push to `main`, wait for the Vercel deploy, then
   `npm run bench -- live`. Compare with step 1.
6. **Record.** Every bench appends a row to `docs/jarvis-speed-log.md`. Add one
   line under "Changes" in that file saying what changed and what it did.
7. **Tell Daniel** in plain words: before, after, what changed, anything he has
   to do. Short.

## Speed levers, best first

| Lever | Where | Notes |
|---|---|---|
| Teach `quickRoute()` a new plain question | `api/_lib/jarvis.js` | Biggest win: AI time goes to zero. Add the phrase to the route table in `scripts/test.mjs` first. Anything with a write word must stay null |
| Word a new action's result in `speakResult()` | same | Removes the second AI call for that action |
| Reorder `JARVIS_MODELS` | `api/_lib/ai.js` | Only on bench evidence: `models` mode, 2+ runs, "right action" at 100% including the date, time and id checks. Keep 2 or 3 fallbacks from different providers |
| Per-call timeout (`timeoutMs`, now 12s) | `agent()` | A stuck model falls through to the next one sooner. Too low turns slow answers into failures |
| Prompt size | `systemPrompt()`, `SPOKEN`, tool descriptions | Fewer tokens in means a faster first token. Cut words, never rules |
| Prefetch in parallel | top of `handle()` | Anything the AI will need should be fetched in the same `Promise.all` |
| Move work after the reply | `later` + `waitUntil` in `api/jarvis.js` | Only for work whose result Daniel does not need to hear |
| Perceived speed on the phone | Jarvis section of `public/app.js` | E.g. show "Thinking..." at once. The phone speaks for free, so voice is never the bottleneck |

## Quality levers

| Symptom | Fix |
|---|---|
| Wrong action picked | Tool description in `TOOLS`, or a rule in `SPOKEN`. Add the phrase to `WRITE` in `scripts/jarvis-bench.mjs` with an `args` check |
| Right action, wrong detail (day, time, task) | Same, plus check `systemPrompt()` gives today's date and weekday |
| A reply sounds robotic or long | The `speak*` functions. One to three short sentences, answer first |
| A question went to the AI and was slow | Add it to `quickRoute()` and to the route table in `scripts/test.mjs` |
| A quick answer was wrong | Fix the `speak*` function or `whichDays()`, then add a test case |
| The AI says "done" but nothing changed | Guarded: in `agent()`, a request with a write word that gets no action back is answered "I didn't change anything". Never remove that guard. A model that does this often in the bench (it happened with nex-n2.5-mini) is not a candidate |

## Scouting new free models

Free models come and go. To check for faster ones:

```bash
curl -s https://openrouter.ai/api/v1/models   # keep ids ending ":free" whose supported_parameters include "tools"
npm run bench -- models --runs 2 --models id1,id2
```

Only models that score 100% "right action" over 2 runs are candidates. Put the
fastest first in `JARVIS_MODELS`, and keep at least one model from a different
provider as a fallback.

## Commands

| Command | What it does | AI requests used |
|---|---|---|
| `npm test` | Pattern, routing and reply checks. No network | 0 |
| `npm run bench -- real [--days 7]` | Daniel's real Jarvis speed, from `events` | 0 |
| `npm run bench -- local [--runs 2]` | This laptop's code against his real data, read-only phrases | Only for phrases that reach the AI |
| `npm run bench -- live [--runs 2]` | The deployed app, read-only phrases | Same |
| `npm run bench -- models --models a,b [--runs 2]` | Each model picks actions for 9 phrases; nothing is run | 9 per model per run |

All need `pocket/.env.local` (Supabase URL, publishable key, secret key, OpenRouter key).
