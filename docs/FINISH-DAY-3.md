# Finish Day 3: the steps only you can do

About 25 minutes. Everything else is built, tested and on GitHub, including Jarvis.

| # | Step | Where |
|---|---|---|
| 1 | Create the tables | Supabase |
| 2 | ~~Sign-in code in the email~~ SKIPPED | Supabase needs custom SMTP for that. Pocket signs in with a pasted link instead |
| 3 | Copy the secret key | Supabase |
| 4 | Copy the two Google values | Vercel, daniel-os |
| 5 | Let Jarvis edit the calendar | Google Cloud, then Daniel OS |
| 6 | Deploy Pocket, send Claude the link | Vercel |
| 7 | Install on the iPhone | Safari |
| 8 | Try Jarvis | Pocket |

## 1. Supabase: create the tables (2 min) - DONE 2026-09-23
https://supabase.com/dashboard/project/ygtpkmtzxqgkhtjdnvpp/sql/new
Paste all of `pocket/supabase/schema.sql`, Run. The "destructive operations" warning is
expected: it only re-creates the security rule on Pocket's four new tables.

## 2. Sign-in email: SKIPPED
Supabase only lets you edit email templates with custom SMTP. Pocket now signs in by
pasting the link from the email instead of typing a code (see step 7).

## 3. Supabase: copy the secret key (1 min)
1. https://supabase.com/dashboard/project/ygtpkmtzxqgkhtjdnvpp/settings/api-keys
2. **Secret keys** section. Copy the one there (starts `sb_secret_`), or **Add new secret
   key**, name it `pocket`, then copy it.
3. Paste it after `SUPABASE_SECRET_KEY=` in `pocket/.env.local`. Save.

## 4. Copy the two Google values (2 min)
1. https://vercel.com/turnkey10/daniel-os/settings/environment-variables
2. Reveal `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, paste each after the matching
   `=` in `pocket/.env.local`. Save.

## 5. Google: let Jarvis edit your calendar (3 min)
1. https://console.cloud.google.com/auth/scopes (check the project picker says Daniel OS).
2. **Add or remove scopes**, tick `.../auth/calendar.events`, **Update**, **Save**.
3. https://daniel-os-psi.vercel.app: sign out, sign back in with Google, **Allow**.

## 6. Vercel: deploy (5 min)
1. https://vercel.com/new, import **dbelt45/pocket**.
2. Framework Preset **Other**. Leave build settings empty.
3. Environment Variables: copy all of `pocket/.env.local`, paste into the first Key box.
   It becomes 10 variables.
4. **Deploy**. Send Claude the main link (`https://pocket-....vercel.app`).

## 7. iPhone: install and use it tonight (5 min)
1. Open the link in **Safari**. **Share**, **Add to Home Screen**, **Add**.
2. Open **Pocket from the Home Screen**, enter your email, tap **Send link**.
3. In the email, **do not tap the link**. Press and hold it, tap **Copy Link**.
4. Back in Pocket, paste into the box, tap **Sign in**.
5. **Turn on morning reminder**, **Allow**, **Send it now**.
6. Capture 3 real things. Airplane Mode on, capture one more, Airplane Mode off.

## 8. Jarvis (5 min)
"What's on today?", "Add a task to send Ricky the Day 3 report", "Jarvis, I have a
thought", "Take the Day 3 report task off my list" then "yes". Siri setup is at the
bottom of Pocket.
