# Supabase backend (community features)

Optional. The app runs fully without it; sign-in, bookmark sync, minute comments
and questions only turn on when `EXPO_PUBLIC_COMMUNITY_ENABLED=true`.

- `config.toml` — Supabase CLI config (local dev + link target).
- `migrations/20261114000000_init.sql` — schema, RLS, grants, triggers, realtime.

## Provision

1. Create a project at <https://supabase.com/dashboard>. Note the project ref,
   the project URL and the anon (publishable) key (Project Settings -> API).
2. Create a GitHub OAuth app at <https://github.com/settings/developers>:
   - Authorization callback URL: `https://<project-ref>.supabase.co/auth/v1/callback`
   - Keep the client ID and generate a client secret.
3. In the Supabase dashboard:
   - Authentication -> Providers -> GitHub: enable, paste client ID + secret.
   - Authentication -> URL Configuration -> Redirect URLs: add
     `shiryakhat://auth/callback` (exact match).
4. Apply the schema:

   ```sh
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```

   If `db push` complains about the Postgres version, set `db.major_version`
   in `config.toml` to the hosted project's major version.

## App environment

```sh
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon / publishable key>
EXPO_PUBLIC_COMMUNITY_ENABLED=true
```

Put them in `.env.local` for development. Store builds run on EAS, so also add
them to the EAS `production` environment (`eas env:create`), see
`docs/release.md`. These three values are public by design (they are compiled
into the app); the **service role key must never be put in the app or in an
`EXPO_PUBLIC_*` variable**.

## Local development (optional, needs Docker)

```sh
# supabase/.env (do not commit)
SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID=...
SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET=...
```

```sh
npx supabase start      # prints the local API URL and anon key
npx supabase db reset   # re-apply migrations from scratch
```

For local OAuth use a second GitHub OAuth app whose callback URL is
`http://127.0.0.1:54321/auth/v1/callback`.

## Rules the client must follow

Privileges are column-scoped (see the comments in the migration):

| Table             | Client may write                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `profiles`        | update `username`, `avatar_url` of own row                                                |
| `bookmarks`       | everything on own rows (upsert is fine); `updated_at` is always set by the server         |
| `minute_comments` | insert `id, user_id, episode_id, time_sec, body`; update `body`; delete own               |
| `questions`       | insert `id, user_id, kind, body, episode_id`; update `kind, body, episode_id`; delete own |
| `question_votes`  | insert `question_id, user_id`; delete own                                                 |

Sending any other column (for example `created_at`, `status`, `upvote_count`),
or using `.upsert()` on `minute_comments` / `questions` / `question_votes`,
fails with `42501 permission denied`. `user_id` can be omitted everywhere; it
defaults to the signed-in user.

Moderation (changing `questions.status`, removing content) is done from the
dashboard or with the service role key, never from the app.

Not included yet: rate limiting / spam protection and a report-content flow.
Add them before enabling community features for a wide audience.
