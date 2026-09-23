# Pocket

A phone app for catching things on the go. Type or dictate anything - an idea,
a to-do, "call the pastor back Friday" - and AI sorts it into a **task**, a
**follow-up** or a **note**, with a due date when you said one. Tasks also land
in the Daniel OS task list. Every morning a notification says what is due and
how the day looks.

**Jarvis** is the voice. Tap the Jarvis button, or say "Hey Siri, Jarvis", and talk:
add or remove calendar events, add or remove tasks, hear your tasks and meetings read
back, get a spoken summary of the day, or say **"Jarvis, I have a thought"** to save an
idea to the Thoughts tab, where the AI says whether it is realistic and how to start.

Project 2 of Daniel Belt's 14-day AI Build Curriculum (Day 3).

Live: https://pocket-nine-coral.vercel.app

## What it does, mapped to the Day 3 checklist

| Requirement | How Pocket meets it |
|---|---|
| Installable PWA, manifest and service worker, on iPhone home screen | `public/manifest.webmanifest`, `public/sw.js`, iOS tags in `public/index.html` |
| Authentication and a persistent database | Supabase email sign-in (link pasted into the app); `captures` table in Postgres with row-level security |
| Sensible offline | Captures queue on the phone and send when a signal returns; last list and calendar shown as a "saved copy"; red Offline badge |
| One meaningful AI feature | `/api/sort` sorts notes into task, follow-up or note. `/api/jarvis` turns speech into actions. Thoughts get a verdict and first steps |
| One external API | Google Calendar: read, add and delete events; today's meetings at the top and in the morning message |
| Notifications | Web push, a morning reminder sent by a Vercel cron, plus "Send it now" |
| Usage analytics | `events` table, tagged `app = pocket`: opens, captures, done, push enabled |
| Mobile-first UX, HTTPS | Built for a 390px screen first; Vercel serves HTTPS |

## Stack, and why

| Piece | Choice | Why |
|---|---|---|
| Front end | One HTML page, one JS file, no framework | A small app. No build step means the service worker caches exact, known files |
| Server | Vercel functions in `api/` | Holds the secrets (AI key, Google secret, push key) away from the phone |
| Database + login | The same Supabase project as Daniel OS | One login for both apps; a task from Pocket shows up in Daniel OS |
| AI | OpenRouter free models, same list as Daniel OS | Ricky directive: no paid AI calls |
| Push | `web-push` library | Push messages must be encrypted per phone; not something to hand-write |

## Jarvis

| You say | Jarvis does |
|---|---|
| "What's on today?" / "Summarize my day" | Reads meetings, tasks due or overdue, follow-ups due |
| "Add a task to call Tim Friday" | Adds it to the Daniel OS task list and to Pocket |
| "Check off the Vercel task" | Marks it done in both places |
| "Take the Vercel task off my list" | Asks "Just to be sure, remove ...?" and deletes only on yes |
| "Put a meeting with Tim tomorrow at 2 for 45 minutes" | Adds it to Google Calendar |
| "What's on my calendar Friday?" | Reads that day back |
| "Cancel my 3 o'clock" | Asks to confirm, then deletes the event |
| "What follow-ups do I have?" / "Read me my thoughts" | Reads them back |
| "Jarvis, I have a thought" | Answers "What are you thinking?", saves the next thing you say to Thoughts, gives a quick take out loud |

How it is built (`api/_lib/jarvis.js`):
- **"I have a thought" and "yes" are matched by plain patterns, not AI**, so they always
  work and cost nothing. Tested in `npm test`.
- Everything else goes to the AI with a fixed list of nine actions. It can only do what is
  on that list, and the server runs each action, scoped to your own rows.
- **Deletes always ask first.** The question and the item are remembered for two minutes
  in `jarvis_state`, so the next sentence is read as the answer. Anything but a yes
  cancels it.
- Listening and speaking use the phone's own speech engine, which is free. If the browser
  cannot listen, type or use the keyboard mic in the same box.
- With no signal, whatever you said is saved as a note, never lost.
- **Siri** uses a personal key (`pk_...`) because Siri cannot sign in. Only the key's
  SHA-256 fingerprint is stored in `jarvis_tokens`. Setup steps appear in the app under
  "Set up Hey Siri, Jarvis".
- **Reviewing thoughts from Claude Code:** `npm run thoughts` lists thoughts with no review;
  `npm run thoughts -- review <id> <file>` writes one back. It shows in the app as
  "Claude's review".

## Setup from scratch

1. **Database.** Supabase, SQL Editor, New query, paste `supabase/schema.sql`, Run.
   For Jarvis to change the calendar, Daniel OS must request the
   `calendar.events` scope (it does since 2026-09-23), and you sign in to Daniel OS once
   more so Google grants it.
   Needs the Daniel OS schema run first (Pocket reuses `tasks`, `events`,
   `integration_log`, `integration_tokens`).
2. **Sign-in.** Nothing to set up. Pocket emails the standard sign-in link; you copy it
   (press and hold, Copy Link) and paste it into the app. A 6-digit code also works if you
   add `{{ .Token }}` to the Magic Link template, which Supabase only allows with custom SMTP.
3. **Settings.** Copy `.env.example` to `.env.local` and fill it in. Make push keys with
   `npx web-push generate-vapid-keys`, and a cron secret with any long random string.
4. **Run locally.** `npm install`, `npm run dev`, open http://localhost:3001.
   `npm run check` shows which parts are live. `npm test` checks the AI reply parser.
5. **Deploy.** Vercel, Add New Project, import this repo, framework **Other**,
   paste `.env.local` into Environment Variables, Deploy. Pushing to `main` redeploys.
6. **Install.** On the iPhone open the URL in Safari, Share, Add to Home Screen.
   Open it from the Home Screen, sign in by pasting the emailed link, tap "Turn on morning reminder".

## Where secrets live

Nowhere in this repo. `.env.local` is gitignored.

| Setting | Lives in | Reaches the phone? |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Vercel | Yes, via `/api/config`. Safe: row-level security decides what any session can read |
| `VAPID_PUBLIC_KEY` | Vercel | Yes. It is the public half, meant to be shared |
| `SUPABASE_SECRET_KEY` | Vercel, server only | **Never.** Only the morning cron and Siri requests use it, because neither has a signed-in session |
| `OPENROUTER_API_KEY`, `GOOGLE_CLIENT_SECRET`, `VAPID_PRIVATE_KEY`, `CRON_SECRET` | Vercel, server only | **Never** |

To rotate one: make a new value where it was issued, paste it into Vercel,
redeploy, then delete the old one. Rotating the VAPID keys signs every phone out
of notifications, so each phone taps "Turn on morning reminder" again.

## When something fails

| What fails | What you see | Where it is logged |
|---|---|---|
| No signal | Red "Offline" badge. New notes save and show "Waiting for a signal"; the list and calendar show the saved copy | Nothing to log |
| AI busy or out of free requests | Notes stay saved and "Sorting...", a message says it will retry, and it does on the next open | `integration_log`, provider `openrouter` |
| AI answers with junk for one note | That note shows "AI could not sort this" and a Try again button | `integration_log` |
| Google Calendar | "Calendar unavailable" and why, never an empty day | `integration_log`, provider `google_calendar` |
| Push to a phone that removed the app | Subscription deleted, not retried forever | `integration_log`, provider `web_push` |
| The morning cron | Vercel keeps each run's response | Vercel, Project, Cron Jobs |

## Honest limits

- **Free AI allows about 50 requests a day, shared with Daniel OS.** Pocket sorts
  every waiting note in one request to stretch that. A one-time $10 of OpenRouter
  credit raises it to 1,000 a day.
- **The morning reminder arrives between 7:00 and 8:00 AM Austin time**, not at an
  exact minute. Vercel's free plan runs a daily cron somewhere inside the hour.
- **Changes to old notes need a signal.** Only new notes queue offline.
- **iPhone can clear an installed web app's storage** if it goes unused for weeks.
  Anything already synced is safe in the database; only unsent notes would be lost.
- Deleting a capture that became a task leaves the task in Daniel OS on purpose.
- **Jarvis waits on the AI.** A command takes about 2 to 10 seconds; a thought with feedback
  about 20. Each command uses one to three of the 50 free daily requests.
- **Listening inside the installed app depends on iOS.** If the phone's browser does not
  offer speech recognition there, the Jarvis box falls back to typing or the keyboard mic.
  Siri always works.

## Proving it to Ricky

```sql
-- the records
select kind, title, due_on, ai_status, captured_at from captures order by captured_at desc limit 20;
-- the analytics
select name, count(*) from events where meta->>'app' = 'pocket' group by name order by 2 desc;
-- every outside call, including failures
select provider, ok, status, message, created_at from integration_log
where message like '[pocket]%' or provider = 'web_push' order by created_at desc limit 20;
```

Plain-English design notes: `docs/WALKTHROUGH.md`.
