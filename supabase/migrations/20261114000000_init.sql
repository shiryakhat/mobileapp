-- =============================================================================
-- Shir ya Khat — initial community schema
--
-- Tables (schema public):
--   profiles         public profile, auto-created from auth.users (GitHub OAuth)
--   bookmarks        private per-user cloud sync of local bookmarks (soft delete)
--   minute_comments  timestamp-anchored comments on an episode
--   questions        questions for the next episode + topic suggestions
--   question_votes   one upvote per (question, user); keeps upvote_count in sync
--
-- Security model (this is a public backend, the anon key ships in the app):
--   1. RLS is enabled on every table.
--   2. Table privileges are REVOKED first and then granted explicitly, per
--      column where it matters. RLS decides *which rows*; grants decide *which
--      columns*. Server-owned columns (questions.status, questions.upvote_count,
--      created_at on community tables, profiles.id, ...) are simply never
--      granted to client roles, so no policy mistake can expose them.
--   3. user_id defaults to auth.uid() and every INSERT/UPDATE policy has
--      WITH CHECK (user_id = auth.uid()), so it cannot be spoofed.
--   4. SECURITY DEFINER functions are trigger-only, pin search_path = '' and
--      fully qualify every object; EXECUTE is revoked from client roles.
--
-- Idempotent-friendly: safe to re-run (IF NOT EXISTS / OR REPLACE / DROP IF
-- EXISTS). Each statement that replaces an object is preceded by its drop.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text,
  avatar_url  text,
  created_at  timestamptz default now(),

  -- GitHub-login shaped. Keeping this strict (ASCII only) also rules out
  -- homoglyph / whitespace impersonation when users edit their own profile.
  constraint profiles_username_format
    check (username is null or username ~ '^[A-Za-z0-9_-]{1,39}$'),
  -- Only https URLs: avatar_url is rendered by other users' clients.
  constraint profiles_avatar_url_format
    check (avatar_url is null or (avatar_url ~ '^https://' and char_length(avatar_url) <= 2048))
);

comment on table public.profiles is
  'Public profile, one row per auth user. Created by trigger on auth.users.';

-- Usernames are publicly displayed and user-editable: make them unique
-- (case-insensitively) so nobody can take over another user's handle.
create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));

-- Creates the profile row when a user signs up.
-- SECURITY DEFINER because the inserting role (supabase_auth_admin) has no
-- rights on public.profiles. Input comes from the OAuth provider and is
-- treated as untrusted: anything that would violate a constraint is nulled
-- instead of raising, because an exception here would block the sign-up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_username text := new.raw_user_meta_data ->> 'user_name';
  v_avatar   text := new.raw_user_meta_data ->> 'avatar_url';
begin
  if v_username is null or v_username !~ '^[A-Za-z0-9_-]{1,39}$' then
    v_username := null;
  end if;

  if v_avatar is null or v_avatar !~ '^https://' or char_length(v_avatar) > 2048 then
    v_avatar := null;
  end if;

  begin
    insert into public.profiles (id, username, avatar_url)
    values (new.id, v_username, v_avatar)
    on conflict (id) do nothing;
  exception when unique_violation then
    -- Username already taken (someone renamed themselves to it first).
    -- Never block sign-up over that: create the profile without a username.
    insert into public.profiles (id, username, avatar_url)
    values (new.id, null, v_avatar)
    on conflict (id) do nothing;
  end;

  return new;
end;
$fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- -----------------------------------------------------------------------------
-- bookmarks (private; cloud copy of the device-local bookmarks)
-- -----------------------------------------------------------------------------
create table if not exists public.bookmarks (
  id          uuid primary key default gen_random_uuid(),  -- normally client-generated
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  episode_id  text not null,
  time_sec    integer,                                     -- null = whole-episode bookmark
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,                                 -- soft delete (tombstone for sync)

  constraint bookmarks_episode_id_length check (char_length(episode_id) between 1 and 200),
  constraint bookmarks_time_sec_nonneg   check (time_sec is null or time_sec >= 0),
  constraint bookmarks_note_length       check (note is null or char_length(note) <= 10000)
);

comment on table public.bookmarks is
  'Private per-user bookmarks. Soft-deleted via deleted_at so deletions sync across devices.';

-- Sync cursor: "give me my rows changed since <last pull>".
create index if not exists bookmarks_user_id_updated_at_idx
  on public.bookmarks (user_id, updated_at);

-- updated_at is the sync cursor, so it must come from ONE clock: the server's.
-- It is therefore overwritten on insert as well as update; whatever the client
-- sends is ignored (a device with a skewed clock would otherwise write rows
-- that other devices never pull).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists bookmarks_set_updated_at on public.bookmarks;
create trigger bookmarks_set_updated_at
  before insert or update on public.bookmarks
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- minute_comments (comments anchored to a timestamp of an episode)
-- -----------------------------------------------------------------------------
create table if not exists public.minute_comments (
  id          uuid primary key default gen_random_uuid(),
  -- FK to profiles (not auth.users) so PostgREST can embed
  -- profiles(username, avatar_url). profiles cascades from auth.users.
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  episode_id  text not null,
  time_sec    integer not null check (time_sec >= 0),
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now(),

  constraint minute_comments_episode_id_length check (char_length(episode_id) between 1 and 200)
);

create index if not exists minute_comments_episode_id_time_sec_idx
  on public.minute_comments (episode_id, time_sec);
create index if not exists minute_comments_user_id_idx
  on public.minute_comments (user_id);


-- -----------------------------------------------------------------------------
-- questions (ask-for-next-episode + topic suggestions)
-- -----------------------------------------------------------------------------
create table if not exists public.questions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind          text not null check (kind in ('question', 'topic')),
  body          text not null check (char_length(body) between 3 and 1000),
  episode_id    text,
  -- Server-owned: moderators change it with the service role / dashboard.
  status        text not null default 'open'
                  check (status in ('open', 'planned', 'answered', 'archived')),
  -- Server-owned: maintained by the question_votes trigger below.
  upvote_count  integer not null default 0,
  created_at    timestamptz not null default now(),

  constraint questions_episode_id_length
    check (episode_id is null or char_length(episode_id) between 1 and 200)
);

create index if not exists questions_status_upvote_count_idx
  on public.questions (status, upvote_count desc);
create index if not exists questions_user_id_idx
  on public.questions (user_id);


-- -----------------------------------------------------------------------------
-- question_votes
-- -----------------------------------------------------------------------------
create table if not exists public.question_votes (
  question_id  uuid not null references public.questions (id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (question_id, user_id)
);

create index if not exists question_votes_user_id_idx
  on public.question_votes (user_id);

-- Keeps questions.upvote_count equal to the number of vote rows.
-- SECURITY DEFINER because clients have no UPDATE privilege on upvote_count.
-- It only ever touches the single question the vote row points at, by +/-1,
-- and takes no caller-controlled input beyond that (already RLS-checked) row.
-- The primary key guarantees one vote per user, so the count cannot be
-- inflated by repeated inserts. UPDATE on question_votes is not granted to
-- clients, so a vote can never be moved between questions.
create or replace function public.handle_question_vote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' then
    update public.questions
       set upvote_count = upvote_count + 1
     where id = new.question_id;
    return new;
  elsif tg_op = 'DELETE' then
    -- When the question itself is being deleted (cascade) this matches no row.
    update public.questions
       set upvote_count = greatest(upvote_count - 1, 0)
     where id = old.question_id;
    return old;
  end if;
  return null;
end;
$fn$;

drop trigger if exists question_votes_sync_count on public.question_votes;
create trigger question_votes_sync_count
  after insert or delete on public.question_votes
  for each row execute function public.handle_question_vote();


-- -----------------------------------------------------------------------------
-- Function privileges
-- Trigger functions are not meant to be called through the API. Triggers keep
-- firing regardless of EXECUTE (it is only checked when the trigger is created).
-- -----------------------------------------------------------------------------
revoke all on function public.handle_new_user()      from public, anon, authenticated;
revoke all on function public.set_updated_at()       from public, anon, authenticated;
revoke all on function public.handle_question_vote() from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- Table privileges
-- Start from zero (Supabase may or may not have granted ALL to anon and
-- authenticated by default, depending on the project's Data API settings),
-- then grant exactly what the app needs.
--
-- NOTE for client code: because INSERT/UPDATE are column-scoped, a request
-- that names any other column (e.g. sending created_at, status, or using
-- .upsert() on minute_comments/questions) is rejected with 42501
-- "permission denied". Use .insert() / .update() with the listed columns only.
-- -----------------------------------------------------------------------------
revoke all on table
  public.profiles,
  public.bookmarks,
  public.minute_comments,
  public.questions,
  public.question_votes
from public, anon, authenticated;

grant all on table
  public.profiles,
  public.bookmarks,
  public.minute_comments,
  public.questions,
  public.question_votes
to service_role;

-- profiles: world-readable; owner may edit display fields only.
grant select on table public.profiles to anon, authenticated;
grant update (username, avatar_url) on table public.profiles to authenticated;

-- bookmarks: private data, owner has full control of own rows (RLS below),
-- including upsert with client-side id / created_at / deleted_at.
grant select, insert, update, delete on table public.bookmarks to authenticated;

-- minute_comments: world-readable; author may edit the body or delete.
grant select on table public.minute_comments to anon, authenticated;
grant insert (id, user_id, episode_id, time_sec, body) on table public.minute_comments to authenticated;
grant update (body) on table public.minute_comments to authenticated;
grant delete on table public.minute_comments to authenticated;

-- questions: world-readable; author may edit content or delete.
-- status and upvote_count are deliberately absent from INSERT and UPDATE.
grant select on table public.questions to anon, authenticated;
grant insert (id, user_id, kind, body, episode_id) on table public.questions to authenticated;
grant update (kind, body, episode_id) on table public.questions to authenticated;
grant delete on table public.questions to authenticated;

-- question_votes: world-readable; a user adds / removes their own vote.
grant select on table public.question_votes to anon, authenticated;
grant insert (question_id, user_id) on table public.question_votes to authenticated;
grant delete on table public.question_votes to authenticated;


-- -----------------------------------------------------------------------------
-- Row level security
-- (select auth.uid()) instead of auth.uid(): evaluated once per statement
-- (initplan) rather than once per row.
-- -----------------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.bookmarks       enable row level security;
alter table public.minute_comments enable row level security;
alter table public.questions       enable row level security;
alter table public.question_votes  enable row level security;

-- profiles --------------------------------------------------------------------
drop policy if exists "profiles: read for everyone" on public.profiles;
create policy "profiles: read for everyone"
  on public.profiles for select
  to anon, authenticated
  using (true);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
  on public.profiles for update
  to authenticated
  using      (id = (select auth.uid()))
  with check (id = (select auth.uid()));
-- No insert policy (rows come from the auth trigger) and no delete policy
-- (rows go away when the auth user is deleted).

-- bookmarks -------------------------------------------------------------------
drop policy if exists "bookmarks: read own" on public.bookmarks;
create policy "bookmarks: read own"
  on public.bookmarks for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "bookmarks: insert own" on public.bookmarks;
create policy "bookmarks: insert own"
  on public.bookmarks for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "bookmarks: update own" on public.bookmarks;
create policy "bookmarks: update own"
  on public.bookmarks for update
  to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "bookmarks: delete own" on public.bookmarks;
create policy "bookmarks: delete own"
  on public.bookmarks for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- minute_comments -------------------------------------------------------------
drop policy if exists "minute_comments: read for everyone" on public.minute_comments;
create policy "minute_comments: read for everyone"
  on public.minute_comments for select
  to anon, authenticated
  using (true);

drop policy if exists "minute_comments: insert own" on public.minute_comments;
create policy "minute_comments: insert own"
  on public.minute_comments for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "minute_comments: update own" on public.minute_comments;
create policy "minute_comments: update own"
  on public.minute_comments for update
  to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "minute_comments: delete own" on public.minute_comments;
create policy "minute_comments: delete own"
  on public.minute_comments for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- questions -------------------------------------------------------------------
drop policy if exists "questions: read for everyone" on public.questions;
create policy "questions: read for everyone"
  on public.questions for select
  to anon, authenticated
  using (true);

drop policy if exists "questions: insert own" on public.questions;
create policy "questions: insert own"
  on public.questions for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "questions: update own" on public.questions;
create policy "questions: update own"
  on public.questions for update
  to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "questions: delete own" on public.questions;
create policy "questions: delete own"
  on public.questions for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- question_votes --------------------------------------------------------------
drop policy if exists "question_votes: read for everyone" on public.question_votes;
create policy "question_votes: read for everyone"
  on public.question_votes for select
  to anon, authenticated
  using (true);

drop policy if exists "question_votes: insert own" on public.question_votes;
create policy "question_votes: insert own"
  on public.question_votes for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "question_votes: delete own" on public.question_votes;
create policy "question_votes: delete own"
  on public.question_votes for delete
  to authenticated
  using (user_id = (select auth.uid()));


-- -----------------------------------------------------------------------------
-- Realtime
-- Postgres Changes respects the SELECT policies above. Guarded so the
-- migration can be re-run and also works where the publication is missing.
-- -----------------------------------------------------------------------------
do $do$
declare
  t text;
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise notice 'publication supabase_realtime not found, skipping realtime setup';
    return;
  end if;

  foreach t in array array['minute_comments', 'questions'] loop
    if not exists (
      select 1
        from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$do$;
