# Finish Day 3: the steps only you can do

About 30 minutes. Everything else is built, tested and on GitHub, including Jarvis.

## 1. Supabase: create the tables (2 min)
*Closes: "Authentication and a persistent database"*

1. supabase.com, your Daniel OS project, **SQL Editor**, **New query**.
2. Paste all of `pocket/supabase/schema.sql`, **Run**. It should say "Success. No rows returned".

## 2. Supabase: put the code in the sign-in email (2 min)
*Closes: "Authentication" on iPhone*

1. **Authentication**, **Emails** (or Email Templates), **Magic Link**.
2. Add this line to the message body, anywhere: `Your code: {{ .Token }}`
3. Save.

Why: on iPhone a sign-in link opens Safari, not the installed app, so the app never
gets signed in. A code typed into the app avoids that.

## 3. Supabase: copy the secret key (1 min)

1. **Project Settings**, **API Keys**, **Secret keys**. Create one named `pocket` if none exists.
2. Paste it after `SUPABASE_SECRET_KEY=` in `pocket/.env.local`.

Only the morning reminder and Siri requests use it. It never reaches the phone.

## 4. Copy the two Google values (2 min)

In **Vercel**, the **daniel-os** project, **Settings**, **Environment Variables**, copy
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` into the matching lines of
`pocket/.env.local`. (They are not in the Day 1 local file, only in Vercel.)

## 4b. Google: let Jarvis edit your calendar (3 min)
*Closes: "add and remove things to my calendar"*

Daniel OS used to ask Google for read-only calendar access. It now asks for
permission to add and delete events (already pushed and deployed).

1. console.cloud.google.com, your Daniel OS project, **Google Auth Platform** (or
   **OAuth consent screen**), **Data Access**, **Add or remove scopes**.
2. Tick `.../auth/calendar.events`, **Update**, **Save**.
3. Open Daniel OS, **sign out, sign back in with Google**, and allow the new calendar
   permission when Google asks. Until you do, Jarvis can read your calendar but will
   say he cannot change it yet.

## 5. Vercel: deploy (5 min)
*Closes: "deployed over HTTPS"*

1. vercel.com, **Add New**, **Project**, import **dbelt45/pocket**.
2. Framework preset: **Other**. Leave the build settings empty.
3. **Environment Variables**: open `pocket/.env.local`, copy the whole thing, paste it
   into the first Key box. Vercel splits it into all 10 variables.
4. **Deploy**. Send me the URL and I will verify it, update the README and run the checks.

## 6. Decide: $10 of OpenRouter credit? (your call)

Today's free AI allowance was already used up when I tested (50 requests a day,
shared with Daniel OS). Pocket still works without it. Notes save and show
"Sorting..." until the allowance resets. A one-time $10 raises the limit to 1,000
a day. This is new spend, so it is your decision, and you may want Ricky's okay.

## 7. iPhone: install and use it tonight (5 min)
*Closes: the ship gate. "Installed on his phone and used the same evening."*

1. Open the Vercel URL in **Safari** (not Chrome).
2. **Share**, **Add to Home Screen**, **Add**.
3. Open **Pocket from the Home Screen**, sign in with the email code.
4. Tap **Turn on morning reminder**, **Allow**, then **Send it now**. You should get a
   notification within a few seconds.
5. Capture 3 real things. Then turn on Airplane Mode, capture one more, and watch it
   say "Waiting for a signal". Turn Airplane Mode off and watch it sync.

The seven-day usage clock starts tonight.

## 8. Jarvis (5 min)

1. In Pocket tap **Jarvis** and allow the microphone. Try:
   - "What's on today?"
   - "Add a task to send Ricky the Day 3 report"
   - "Jarvis, I have a thought" ... then say the thought. Check the **Thoughts** tab.
   - "Take the Day 3 report task off my list", then say "yes".
2. If the Jarvis box says to type instead, the phone's browser will not listen inside the
   installed app. The keyboard mic still works there, and Siri below always works.
3. **Siri:** at the bottom of Pocket tap **Set up "Hey Siri, Jarvis"**. Copy the key and
   follow the six steps shown right there in the Shortcuts app. Then say
   "Hey Siri, Jarvis".
4. To have me review your thoughts from the laptop, say "review my thoughts" in Claude Code.
