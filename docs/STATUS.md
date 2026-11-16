# Project status — what is shipped, what is off, what must change

The source of truth for what the app does **in the store build**, and for what has to be updated
before that changes. Keep it current: a PR that ships, gates or un-gates a feature updates this
file in the same change. Store copy lives in [store-listing.md](store-listing.md); the release
process in [release.md](release.md).

## Shipped (v1)

- **Episode library** — every episode, grouped by season
- **Bilingual synced transcripts** — Farsi + English, following playback
- **Full-text search** — across every transcript
- **Tap-to-define glossary** — blockchain terms explained inline
- **Chapters** — jump between topics
- **Bookmarks / resume** — pick up where you left off
- **Player** — stream or download for offline
- **Light / dark themes + RTL** — full right-to-left Persian interface
- **Deep links** — Universal Links (iOS) / App Links (Android)
- **Coin-flip easter egg**
- **Website + content pipeline** — with a CI drift guard against stale derived content

Since v1.1.0 the layout also adapts to iPad and large Android tablets / foldables: content sits in
a centred, max-width column (see `src/theme/responsive.ts`) instead of stretching edge to edge.

## OFF in v1 (flag-gated)

**Community features** — comments, questions, cloud bookmark sync.

- Controlled by `communityEnabled` in [`src/lib/flags.ts`](../src/lib/flags.ts).
- Turning it on needs `EXPO_PUBLIC_COMMUNITY_ENABLED=true` **and** Supabase credentials
  (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`). These are **NOT** set in the EAS
  production profile.

In production there is therefore:

- **NO** sign-in UI
- **NO** account creation
- **NO** Supabase client
- **NO** user data collected

## Store compliance snapshot (v1)

| Item                    | Status                                                              |
| ----------------------- | ------------------------------------------------------------------- |
| Apple App Privacy       | **Data Not Collected**                                              |
| Google Play Data Safety | **No data collected or shared**                                     |
| Account deletion        | Not needed — there are no accounts                                  |
| Sign in with Apple      | Not required — no third-party login is shown                        |
| Donations               | Kept: external Stripe link (`buy.stripe.com`), opens in the browser |

## Roadmap (future versions)

- **Archive.org links** — integrate each episode's archive.org item as an alternative
  download / view link (a durable mirror alongside the primary audio). Surface it on the
  episode screen (and in the share sheet) so listeners have a fallback source.
- **MCP server** — expose the podcast corpus (episodes, transcripts, glossary, search) as an
  MCP server wrapping `content/`, so agents can query the show without the app.

## When community is ENABLED, you MUST update before releasing

Do not ship a build with `communityEnabled` on until every item below is done:

- [ ] **(a) In-app Account Deletion** — required by Apple guideline 5.1.1(v) and by Google Play.
- [ ] **(b) Login options including Sign in with Apple** (Apple guideline 4.8), alongside
      GitHub / Google.
- [ ] **(c) Privacy declarations** — flip the Apple App Privacy labels and the Play Data Safety
      form to declare the collected data: email + user id via Supabase, linked to identity.
- [ ] **(d) Age rating** — re-review it (user-generated content changes the answers).

Then update this file and [store-listing.md](store-listing.md) (the "App Privacy / Data Safety"
line) to match.
