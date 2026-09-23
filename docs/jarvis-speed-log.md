# Jarvis speed log

Every bench run appends a line here (`npm run bench`). Time is from sending the
sentence to getting the words back; the phone's speaking time is not included.
"Right action" means Jarvis picked an action on the expected list for that phrase.

| When (UTC) | What was measured | Median | Slowest 10% | Right action |
|---|---|---|---|---|
| 2026-09-23T22:21 | live | 9.5s | 19.1s | 10/10 |
| 2026-09-23T22:25 | model thinkingmachines/inkling-small:free | 0.0s | 0.2s | 0/9 |
| 2026-09-23T22:25 | model google/gemma-4-31b-it:free | 0.1s | 0.3s | 0/9 |
| 2026-09-23T22:25 | model google/gemma-4-26b-a4b-it:free | 0.1s | 0.4s | 0/9 |
| 2026-09-23T22:25 | model qwen/qwen3.8-27b:free | 0.1s | 0.3s | 0/9 |
| 2026-09-23T22:25 | model poolside/laguna-xs-2.1:free | 0.2s | 1.1s | 1/9 |
| 2026-09-23T22:25 | model inclusionai/ling-3.0-flash-fin:free | 0.8s | 1.2s | 9/9 |
| 2026-09-23T22:25 | model nex-agi/nex-n2.5-mini:free | 1.0s | 1.6s | 8/9 |
| 2026-09-23T22:25 | model nvidia/nemotron-3-super-120b-a12b:free | 2.1s | 10.0s | 6/9 |
| 2026-09-23T22:25 | model nvidia/nemotron-3-ultra-550b-a55b:free | 3.0s | 15.2s | 8/9 |
| 2026-09-23T22:26 | model inclusionai/ling-3.0-flash-fin:free | 0.8s | 1.2s | 18/18 |
| 2026-09-23T22:26 | model inclusionai/ling-3.0-flash-sante:free | 0.9s | 1.4s | 10/18 |
| 2026-09-23T22:26 | model nvidia/nemotron-3.5-lightning:free | 12.1s | 20.0s | 5/9 |
| 2026-09-23T22:26 | model nex-agi/nex-n2.5-mini:free | 0.7s | 1.9s | 10/18 |
| 2026-09-23T22:28 | local (laptop) | 0.5s | 0.6s | 10/10 |
| 2026-09-23T22:28 | model inclusionai/ling-3.0-flash-sante:free | 1.0s | 1.6s | 17/18 |

## Changes

- **2026-09-23, baseline:** every command went to the AI, usually 2 to 3 calls in a row
  (pick an action, then word the answer). Live median 9.5s, slowest 10% 19.1s, worst 44s.
- **2026-09-23, rebuild:** plain questions (day, calendar, tasks, follow-ups, notes,
  thoughts) answered from the data with no AI. Open tasks (and, for calendar changes,
  events) prefetched into the prompt so actions take one AI call. Simple action results
  worded in code, no second AI call. Thought feedback moved after the reply. Faster
  model order from the models bench. Laptop bench for read questions: median 0.5s.
- **2026-09-23, bench note:** the round 2 model rows above hit the free per-minute rate
  limit (10 models at once, then unpaced), so their "right action" counts are low for
  that reason, not the model. Round 3 is paced and is the one to trust.
| 2026-09-23T22:30 | model nex-agi/nex-n2.5-mini:free | 1.1s | 1.8s | 15/18 |
