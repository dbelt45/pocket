# Pocket

A phone app for catching things on the go. Type or dictate anything - an idea,
a to-do, "call the pastor back Friday" - and AI sorts it into a **task**, a
**follow-up** or a **note**, with a due date when you said one. Tasks also land
in the Daniel OS task list. Every morning a notification says what is due and
how the day looks.

Project 2 of Daniel Belt's 14-day AI Build Curriculum (Day 3).

Live: _add the Vercel URL here once deployed_

## What it does, mapped to the Day 3 checklist

| Requirement | How Pocket meets it |
|---|---|
| Installable PWA, manifest and service worker, on iPhone home screen | `public/manifest.webmanifest`, `public/sw.js`, iOS tags in `public/index.html` |
| Authentication and a persistent database | Supabase email code sign-in; `captures` table in Postgres with row-level security |
| Sensible offline | Captures queue on the phone and send when a signal returns; last list and calendar shown as a "saved copy"; red Offline badge |
| One meaningful AI feature | `/api/sort`: sorts notes into task, follow-up or note, writes a clean title, reads dates like "Friday" |
| One external API | Google Calendar: today's meetings at the top and in the morning message |
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

## Setup from scratch

1. **Database.** Supabase, SQL Editor, New query, paste `supabase/schema.sql`, Run.
   Needs the Daniel OS schema run first (Pocket reuses `tasks`, `events`,
   `integration_log`, `integration_tokens`).
2. **Sign-in code.** Supabase, Authentication, Emails, **Magic Link** template.
   Add `{{ .Token }}` to the body so the email contains the 6-digit code.
3. **Settings.** Copy `.env.example` to `.env.local` and fill it in. Make push keys with
   `npx web-push generate-vapid-keys`, and a cron secret with any long random string.
4. **Run locally.** `npm install`, `npm run dev`, open http://localhost:3001.
   `npm run check` shows which parts are live. `npm test` checks the AI reply parser.
5. **Deploy.** Vercel, Add New Project, import this repo, framework **Other**,
   paste `.env.local` into Environment Variables, Deploy. Pushing to `main` redeploys.
6. **Install.** On the iPhone open the URL in Safari, Share, Add to Home Screen.
   Open it from the Home Screen, sign in, tap "Turn on morning reminder".

## Where secrets live

Nowhere in this repo. `.env.local` is gitignored.

| Setting | Lives in | Reaches the phone? |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Vercel | Yes, via `/api/config`. Safe: row-level security decides what any session can read |
| `VAPID_PUBLIC_KEY` | Vercel | Yes. It is the public half, meant to be shared |
| `SUPABASE_SECRET_KEY` | Vercel, server only | **Never.** Only the morning cron uses it |
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
