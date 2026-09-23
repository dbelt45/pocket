-- Pocket schema. Runs in the SAME Supabase project as Daniel OS, so one login
-- covers both apps and a capture sorted as a task lands in the Daniel OS task list.
-- Paste into Supabase -> SQL Editor -> New query -> Run. Safe to run twice.
--
-- Reused from Daniel OS, not recreated here:
--   tasks             - where a capture sorted as "task" is copied
--   events            - analytics (page views and actions), tagged meta.app = 'pocket'
--   integration_log   - every AI, calendar and push call, success or failure
--   integration_tokens - the Google token the calendar reads with

-- -------------------------------------------------------------- captures
-- One row per thing Daniel typed or dictated.
create table if not exists public.captures (
  -- The phone makes the id, not the database. If a save is queued offline and
  -- then retried twice on a bad connection, the second copy has the same id and
  -- is ignored, so a flaky signal can never create duplicates.
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body        text not null check (length(body) between 1 and 4000),
  kind        text not null default 'unsorted'
              check (kind in ('unsorted','task','followup','note')),
  title       text,
  due_on      date,
  ai_status   text not null default 'pending' check (ai_status in ('pending','done','failed')),
  ai_note     text,
  task_id     uuid references public.tasks(id) on delete set null,
  captured_at timestamptz not null,               -- when he typed it, maybe offline
  created_at  timestamptz not null default now(), -- when it reached the database
  done_at     timestamptz
);
create index if not exists captures_user_time_idx on public.captures (user_id, captured_at desc);

-- ---------------------------------------------------- push_subscriptions
-- One row per phone that said yes to notifications. Apple hands the phone an
-- endpoint URL plus two keys; the server needs all three to deliver a message.
create table if not exists public.push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------------- RLS
-- Same rule as every Daniel OS table: you only ever see your own rows.
alter table public.captures           enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists own_rows on public.captures;
create policy own_rows on public.captures for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists own_rows on public.push_subscriptions;
create policy own_rows on public.push_subscriptions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
