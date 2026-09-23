# Pocket, explained in plain English

Written so you can answer Ricky's questions on Day 14 without notes. Each section
is one decision: what it is, why, and what you would say if he pushes.

## 1. Why this app

I capture things all day - a name from a call, a follow-up, an idea - and they
end up scattered across texts, sticky notes and my head. Pocket is one place to
drop them in five seconds, and the AI does the sorting I would otherwise skip.
It feeds Daniel OS, so nothing I capture on my phone is stranded there.

## 2. What makes it an "app" and not a website

Three things:

- **The manifest** (`manifest.webmanifest`) tells the phone the app's name, icon
  and colors, and to open full screen with no browser bar.
- **The service worker** (`sw.js`) is a small program the phone keeps beside the
  app. It lets Pocket open with no signal and receive notifications while closed.
- **HTTPS.** Phones refuse to run a service worker on an insecure site. Vercel
  gives HTTPS for free.

On iPhone, "Add to Home Screen" from Safari is the install. Apple has no install
button like Android does, which is why Pocket shows a hint in Safari.

## 3. "What did the service worker cache, and why those files?"

**Answer:** only the app's own shell, eight files: the page, `app.js`,
`styles.css`, the Supabase library, the manifest and three icons. That is exactly
what the phone needs to draw the app with no signal.

**What it deliberately does NOT cache:** anything under `/api`. That is my
personal data and it changes, so a cached copy would quietly show old
information as if it were current. Instead the app keeps its own last copy of
the list and calendar and labels it "saved copy", so I always know what I am
looking at.

**How it caches:** "stale while revalidate". It shows the saved copy instantly,
then quietly downloads a fresh one for next time. On a bad connection the app
still opens at once. The trade: after a deploy, the first open shows the old
version and the second shows the new one.

## 4. Offline, and why notes never duplicate

When I hit Save, the note goes into an **outbox on the phone first**, shows up
straight away, and is sent to the database when there is a signal. The badge at
the top says "Offline, 2 waiting" so I know.

The phone makes each note's ID itself. If the signal drops halfway through a
send and the app sends again, the database sees the same ID and ignores the
second copy. That is the whole reason IDs are made on the phone.

Only new notes queue offline. Marking old ones done needs a signal. Queueing
edits too would mean handling conflicts, and I did not need that to use it.

## 5. Sign-in: why a code and not a link or Google

On iPhone, the installed app and Safari keep **separate storage**. A magic link
in an email opens Safari, so Safari gets signed in and the app does not. Google
sign-in has the same problem because it bounces out to Google's page and back.
Typing a 6-digit code into the app itself avoids both.

It is the same Supabase project as Daniel OS, and Supabase matches accounts by
email, so it is the same me, the same user ID, and the same rows.

## 6. The AI feature

`/api/sort` sends every note still waiting, all in **one** request, to a free
model through OpenRouter. It gets back a kind, a clean title and a due date.
One request for the whole batch, because the free tier allows about 50 a day
and Daniel OS shares that allowance.

**The AI's answer is treated as untrusted input.** `parseSort` in
`api/_lib/ai.js` throws away anything with an ID I did not send, a kind I did
not ask for, or a date that is not a real date. `npm test` proves it. If the AI
is down, notes stay saved and wait; nothing is lost, and it tries again next open.

## 7. The external API: Google Calendar

The Today box and the morning message read today's meetings from Google Calendar
API v3. Pocket has no Google login of its own. It reuses the token Daniel OS
stored when I signed in with Google, and the refresh token renews it every hour.
A failure says "Calendar unavailable" and why. It never shows an empty day that
I would read as "no meetings".

## 8. Notifications

- iOS allows web push only for an app on the Home Screen, iOS 16.4 or later, and
  only after I tap a button. That is why the button lives in the installed app.
- When I say yes, Apple gives the phone an address to deliver to, which Pocket
  saves in `push_subscriptions`.
- **VAPID keys** prove to Apple that a message really comes from Pocket. The
  public half goes to the phone; the private half stays in Vercel.
- A **Vercel cron** calls `/api/cron/morning` once a day. It needs a secret, so a
  stranger cannot make it send notifications.
- If Apple says a phone is gone (404 or 410), that subscription is deleted
  instead of retried forever.

## 9. Security in one breath

The only keys the phone ever sees are the publishable key (it just names the
project) and the public push key. Every table has row-level security: a
signed-in person only reads their own rows. The server checks who you are by
asking Supabase about your session token, never by trusting what the phone
claims. Everything secret lives in Vercel's settings.

## 10. What I would do next

- Put $10 on OpenRouter to go from 50 to 1,000 free AI requests a day.
- Let me change a note's type when the AI gets it wrong.
- Reminders at the exact due time instead of one each morning (needs a paid cron
  or a different scheduler).

## 11. Jarvis, the voice

**What he can do.** Nine actions and nothing else: summarize the day, list, add, complete
and delete tasks, list, add and delete calendar events, and read back follow-ups, notes
or thoughts. If Ricky asks "what can it do?", that list is the whole answer. Adding a
capability means adding an action to `TOOLS` in `api/_lib/jarvis.js`.

**How a sentence is handled, in order.**
1. Is Jarvis waiting for an answer? ("What are you thinking?" or "delete X?") Then this
   sentence is that answer.
2. Does it start with "Jarvis, I have a thought"? That is a plain pattern match, no AI,
   so it always works and costs nothing.
3. Anything else goes to the AI with the action list. The AI picks an action, my server
   runs it, and the AI turns the result into one or two spoken sentences.

**Why deletes ask first.** Speech gets misheard. "Cancel my 3 o'clock" could hit the
wrong meeting. So a delete never happens in one step: Jarvis looks up exactly what would
be removed, reads it back, and saves the pending delete for two minutes. Only a yes on
the next sentence runs it. The yes check is a pattern, not AI, so the AI can never
"decide" a yes on its own.

**Why the waiting state lives in the database, not the phone.** Siri and the app both
talk to the same brain. Keeping "what am I waiting for" on the server means the second
sentence works the same from either one.

**Voice costs nothing.** Listening and speaking use the phone's own speech engine. Only
working out what I meant uses the AI.

**Siri and the key.** Siri cannot sign in, so it carries a personal key. It is shown
once, and only its SHA-256 fingerprint is stored, the way a password is. If the phone is
lost, deleting one row in `jarvis_tokens` switches that key off. Siri requests use the
Supabase secret key on the server, so every action there filters by my user ID
explicitly instead of relying on row-level security.

**Thoughts.** A thought gets AI feedback: a verdict (realistic, stretch, not yet), why,
what it could become, and three first steps. The AI's answer is checked like any other
untrusted input before it is saved. A deeper review can be written from Claude Code with
`npm run thoughts`, and it shows in the app as "Claude's review".

**The calendar permission.** Day 1 asked Google for read-only calendar access. Adding
and deleting events needs `calendar.events`, which covers events only, not calendar
settings or sharing. It is the smallest permission that does the job.
