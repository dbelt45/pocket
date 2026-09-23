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
