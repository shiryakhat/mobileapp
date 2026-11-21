# Release pipeline

Push a `v*` tag and GitHub Actions builds the app on EAS and delivers it to
**TestFlight** (iOS) and the **Google Play internal track** (Android).
Promotion to the public stores is a deliberate manual step.

> **Current trigger (check before following sections 4–5).** `release.yml` now runs when a
> **GitHub Release is published** (or on a manual run), not on a bare tag push: after
> `npm version` and `git push --follow-tags`, publish a release for the tag
> (`gh release create vX.Y.Z --generate-notes`). Android is built on the runner
> (`eas build --local`): a signed APK is attached to the GitHub Release and the AAB is uploaded
> to the Play internal track by `scripts/play-upload.mjs`. The iOS job runs only when the
> `RUN_IOS` repository variable is `true`. The header comment of
> `.github/workflows/release.yml` is the source of truth; the diagram and sections 4–5 below
> still describe the earlier tag-push / EAS-cloud flow.

```
npm version patch ──► git push --follow-tags ──► .github/workflows/release.yml
                                                   │
                                   verify: lint · typecheck · test · tag == app version
                                                   │
                         ┌─────────────────────────┴─────────────────────────┐
                    release (ios)                                     release (android)
              eas build -p ios --profile production            eas build -p android --profile production
              eas submit ──► TestFlight                        eas submit ──► Play internal track
```

| File                                 | Role                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `eas.json`                           | Build profiles (`development`, `development-device`, `preview`, `production`) and the `production` submit profile  |
| `.github/workflows/release.yml`      | Tag / manual release                                                                                               |
| `.github/workflows/ci.yml`           | Lint, typecheck, test on PRs and `main`                                                                            |
| `.github/workflows/play-promote.yml` | Manual-only promotion of a Play track to another (beta -> production), see section 6                               |
| `scripts/play-promote.mjs`           | The promotion itself: Play Developer API, no bundle upload                                                         |
| `scripts/asc-prepare-release.mjs`    | Stages an iOS App Store version (version, "What's New", build) and reports readiness; never submits, see section 6 |
| `store/whatsnew/<lang>.txt`          | Store release notes ("What's New") for both stores, one file per language                                          |

What the store build contains (and what is flag-gated off) is tracked in
[STATUS.md](STATUS.md); the listing copy for App Store Connect and Play is in
[store-listing.md](store-listing.md).

App identifiers: iOS bundle identifier `net.shiryakhat.app`, Android package
`net.shiryakhat.app`, scheme `shiryakhat`, slug `shiryakhat`.

---

## 1. One-time setup

Run EAS CLI as `npx eas-cli@latest <command>` (written as `eas` below).

### 1.1 Expo

1. Create an Expo account (or organization) at <https://expo.dev>.
2. `eas login`, then `eas init` in the repo. This creates the EAS project and
   writes `extra.eas.projectId` (and `owner`) into the app config. Commit that.
3. Make sure the app config has `ios.bundleIdentifier` and `android.package`
   set to the identifiers above, and `version` set (see [Versioning](#3-versioning)).
4. Create an access token at <https://expo.dev/settings/access-tokens>
   (for an organization prefer a robot user token) -> secret `EXPO_TOKEN`.
5. Build-time environment. Store builds run on EAS servers, not on the GitHub
   runner, so `EXPO_PUBLIC_*` values must live in the EAS `production`
   environment (the `production` build profile sets `"environment": "production"`):

   ```sh
   eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value "https://<ref>.supabase.co" --visibility plaintext
   eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<anon key>" --visibility plaintext
   eas env:create --environment production --name EXPO_PUBLIC_COMMUNITY_ENABLED --value "true" --visibility plaintext
   ```

   Skip this while community features are off. Before turning them on, work
   through the checklist in [STATUS.md](STATUS.md) (account deletion, Sign in
   with Apple, privacy labels, age rating): a build with the flag on is not
   store-compliant until it is done.

### 1.2 Apple (iOS)

1. Enroll in the Apple Developer Program. Note the **Team ID**
   (<https://developer.apple.com/account> -> Membership details) -> `APPLE_TEAM_ID`.
2. Create the app record in App Store Connect (My Apps -> + -> New App) with
   bundle ID `net.shiryakhat.app`. Its numeric **Apple ID** (App Information ->
   General Information) -> `ASC_APP_ID`.
   (Running `eas submit -p ios` once interactively can create the record for you.)
3. Create an **App Store Connect API key**: Users and Access -> Integrations ->
   App Store Connect API -> Team Keys -> +, role **App Manager** (Admin is
   needed if EAS should also create certificates/profiles with it).
   Download the `.p8` (only possible once) -> `ASC_API_KEY_P8`,
   Key ID -> `ASC_KEY_ID`, Issuer ID -> `ASC_ISSUER_ID`.
4. Signing credentials: the `production` profile uses **local credentials**
   (distribution `.p12` + App Store provisioning profile referenced by a
   git-ignored `credentials.json`), see [1.4](#14-credentials-ios-local-android-eas-managed).
   Do not run the interactive `eas credentials` Apple-ID login to create them:
   it crashes on Node 24 (`The first argument must be of type string ... Received undefined`).

### 1.3 Google (Android)

1. Create the app in Play Console (<https://play.google.com/console>) with
   package `net.shiryakhat.app` and complete the mandatory "App content" forms.
2. Create a **service account**: Google Cloud Console -> IAM & Admin -> Service
   Accounts -> Create; then Keys -> Add key -> JSON. Enable the _Google Play
   Android Developer API_ for that Cloud project.
3. Play Console -> Users and permissions -> Invite new users -> the service
   account email -> grant it release permissions for this app (at least
   "Release to testing tracks"; "Release to production" if you ever submit there).
   The JSON file content -> `GOOGLE_SERVICE_ACCOUNT_KEY_JSON`.
4. Create the upload keystore once, interactively, and let EAS store it:

   ```sh
   eas build --platform android --profile production
   ```

   **Back the keystore up** (`eas credentials -p android` -> download). With
   Play App Signing a lost upload key can be reset by Google, but only via support.

5. **First upload.** Current Expo docs say `eas submit` can create the very first
   release on the internal track as long as the app exists in Play Console and
   the service account has access. If Google rejects it (historically the
   Play API required the first `.aab` to be uploaded by hand), download the
   `.aab` from the EAS build page and upload it once manually in
   Play Console -> Testing -> Internal testing -> Create new release.
6. While the Play app has never passed review it is a _draft app_ and only
   accepts draft releases: set the repository **variable**
   `PLAY_RELEASE_STATUS=draft` and roll the release out by hand in Play
   Console. Delete the variable after the app's first approval.

### 1.4 Credentials: iOS local, Android EAS-managed

**Android**: the release keystore is stored on EAS servers and fetched by the
build via `EXPO_TOKEN`. Nothing signing-related is in the repo or in GitHub.

**iOS**: the `production` build profile sets
`"ios": { "credentialsSource": "local" }`, so `eas build -p ios --profile production`
signs with the files named in a **git-ignored** `credentials.json` in the repo
root (<https://docs.expo.dev/app-signing/local-credentials/>) instead of the
EAS-managed credentials:

```json
{
  "ios": {
    "provisioningProfilePath": "/abs/path/profile.mobileprovision",
    "distributionCertificate": { "path": "/abs/path/dist.p12", "password": "..." }
  }
}
```

The `.p12` ("Apple Distribution: Pangana Inc (2F556JZ8H9)"), its password and
the App Store provisioning profile for `net.shiryakhat.app` live **outside the
repo** on the release machine, next to a ready-made `credentials.json` that
points at them with absolute paths. On a fresh checkout or worktree, copy that
file into the repo root once; nothing else is needed. `credentials.json`,
`*.p12`, `*.mobileprovision`, `*.pem` and `*.p8` are all in `.gitignore` —
never commit them. The pair expires in November 2027; renew it then (new
certificate + profile via the App Store Connect API) and replace the files in
place.

A local iOS release is therefore:

```sh
eas build --platform ios --profile production --local --non-interactive --output app.ipa
eas submit --platform ios --profile production --path app.ipa --non-interactive
```

(`ascAppId` is committed in the `production` submit profile; the
`ASC_API_KEY_*` variables supply the API key.)

The gated CI `ios` job (`RUN_IOS`) builds the same profile on EAS cloud, so
before enabling it, have the job write `credentials.json`, the `.p12` and the
profile from secrets before `eas build`. It does not do that out of the box.

---

## 2. GitHub configuration

Settings -> Secrets and variables -> Actions.

### Secrets

| Name                              | What it is                                                                                             | Where to get it                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `EXPO_TOKEN`                      | Expo access token used by EAS CLI                                                                      | expo.dev -> Account settings -> Access tokens                                  |
| `ASC_API_KEY_P8`                  | App Store Connect API private key: the full text of `AuthKey_XXXX.p8` (raw PEM, or base64 of the file) | App Store Connect -> Users and Access -> Integrations -> App Store Connect API |
| `ASC_KEY_ID`                      | Key ID of that API key                                                                                 | Same page, "Key ID" column                                                     |
| `ASC_ISSUER_ID`                   | Issuer ID of the API keys (UUID)                                                                       | Same page, top of the list                                                     |
| `APPLE_TEAM_ID`                   | Apple Developer Team ID (10 characters)                                                                | developer.apple.com/account -> Membership details                              |
| `ASC_APP_ID`                      | Numeric Apple ID of the app record                                                                     | App Store Connect -> the app -> App Information -> Apple ID                    |
| `GOOGLE_SERVICE_ACCOUNT_KEY_JSON` | Google service account key: full JSON text (or base64 of the file)                                     | Google Cloud Console -> Service Accounts -> Keys                               |

`ASC_APP_ID` and `APPLE_TEAM_ID` are identifiers rather than secrets; they are
kept as secrets only so that no account-specific value lives in the repo.

### Variables (optional)

| Name                  | Default             | Meaning                                                                                        |
| --------------------- | ------------------- | ---------------------------------------------------------------------------------------------- |
| `APPLE_TEAM_TYPE`     | `INDIVIDUAL`        | `INDIVIDUAL`, `COMPANY_OR_ORGANIZATION` or `IN_HOUSE`; passed to EAS as `EXPO_APPLE_TEAM_TYPE` |
| `PLAY_RELEASE_STATUS` | unset (`completed`) | `draft`, `completed`, `inProgress` or `halted`; see 1.3 step 6                                 |

Recommended: protect `v*` tags (Settings -> Rules -> Rulesets) so only
maintainers can trigger a release.

---

## 3. Versioning

Two numbers, two owners:

|                                                                    | Example | Source of truth                                | Changed by                                             |
| ------------------------------------------------------------------ | ------- | ---------------------------------------------- | ------------------------------------------------------ |
| User-facing version (`CFBundleShortVersionString` / `versionName`) | `1.2.0` | `version` in the app config                    | You, per release                                       |
| Build number (`ios.buildNumber` / `android.versionCode`)           | `17`    | EAS servers (`cli.appVersionSource: "remote"`) | EAS, `autoIncrement: true` on the `production` profile |

- Never set `ios.buildNumber` / `android.versionCode` in the app config; they
  are ignored. Every production build gets the next number, so a rebuild of the
  same version is always uploadable.
- Inspect or fix the remote counter with `eas build:version:get` /
  `eas build:version:set` (for example when adopting an app that already has
  builds in the stores). `eas build:version:sync` writes it into local native projects.
- The workflow fails early if the tag is not `v<app config version>`. In this
  repo the two cannot drift: `app.config.js` sets the app config `version` from
  `package.json`, so `npm version` (which also creates the tag) is the single
  source of truth. Keep that file when templating this for another app.

---

## 4. Cutting a release

```sh
git switch main && git pull
npm version patch            # or minor / major; commits and creates tag vX.Y.Z
git push --follow-tags
```

Then watch Actions -> Release. When both jobs are green the build is in
TestFlight (after Apple's processing, usually 5-30 minutes) and on the Play
internal track.

Manual run (no tag): Actions -> Release -> Run workflow, choose `platform`
(`all` / `ios` / `android`) and whether to `submit`. Useful to retry a single
platform; the tag/version check is skipped for manual runs. A failed job of a
tag run can also simply be re-run from the Actions UI.

---

## 5. What the workflow does

`verify` job

1. Checkout, Node 24, `npm ci`.
2. On tag pushes: tag must equal `v` + `npx expo config` version.
3. `npm run lint`, `npm run typecheck`, `npm test`.

`release` job: matrix over `ios` and `android`, `fail-fast: false`, so one
platform can fail without cancelling the other.

1. Checkout, Node 24, install EAS CLI (`expo/expo-github-action`), `npm ci`.
2. Write key files to `$RUNNER_TEMP` (outside the checkout, never uploaded to EAS):
   - iOS: the `.p8`, plus `EXPO_ASC_*` / `EXPO_APPLE_TEAM_*` for the build and
     `ASC_API_KEY_*` for the submit profile.
   - Android: the service account JSON and `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`.
3. `eas build --platform <p> --profile production --non-interactive --json`.
   The runner waits for the EAS build and fails if it fails. The build id is
   taken from the JSON output, so the submit step ships exactly this build.
4. `eas submit --platform <p> --profile production --id <build id> --non-interactive`.
   EAS CLI only substitutes environment variables in `ascApiKeyPath`,
   `ascApiKeyId`, `ascApiKeyIssuerId` and `serviceAccountKeyPath`. `ascAppId`
   (required in non-interactive mode), `appleTeamId` and the optional Android
   `releaseStatus` are therefore merged into the runner's copy of `eas.json`
   with `jq` right before submitting. They never reach git.
5. Key files are deleted (`if: always()`).

Hardening: `permissions: contents: read`, `persist-credentials: false`, actions
pinned to major versions, no `${{ }}` expression is expanded inside a `run:`
script (values go through `env:`), one release per ref via `concurrency` with
no cancellation.

Cost note: the runner idles while EAS builds. To avoid that, replace the build
and submit steps with a single
`eas build --platform <p> --profile production --non-interactive --no-wait --auto-submit`
(EAS submits server-side when the build finishes); you lose the pass/fail
signal in GitHub and get it by email / on expo.dev instead.

---

## 6. Promoting to production

Nothing is released to the public automatically.

- **iOS**: App Store Connect -> the app -> TestFlight to test; then stage the
  version with `scripts/asc-prepare-release.mjs` (below) and press **Add for
  Review** by hand. External TestFlight groups need a one-time Beta App Review.
- **Android**: run the **Play Promote** workflow (below), or do it by hand in
  Play Console -> Testing -> the release -> **Promote release** -> Production,
  set the rollout percentage, send for review. New personal developer accounts
  must complete Google's closed-test requirement before production access is
  granted.

### Play Promote workflow (Android)

To promote the current beta build to production: Actions -> **Play Promote** ->
Run workflow, keep the defaults, Run.

| Input          | Default      | Meaning                                                          |
| -------------- | ------------ | ---------------------------------------------------------------- |
| `source_track` | `beta`       | Track to promote from                                            |
| `target_track` | `production` | Track to promote to                                              |
| `status`       | `completed`  | `completed` rolls out to everyone; `draft` leaves it for a human |
| `dry_run`      | `false`      | Build and validate the Play edit, then stop without committing   |

The workflow is `workflow_dispatch` only. It never runs on push, on a tag or
when a GitHub Release is published, and the Release workflow does not call it,
so nothing reaches production until someone presses Run.

What it does (`scripts/play-promote.mjs`, same service account as the upload):

1. Reads `source_track` and takes the highest versionCode that is rolled out
   there (`completed` or `inProgress`; drafts and halted rollouts are ignored).
   It fails if there is none.
2. Assigns that same versionCode to `target_track` with the chosen status and
   the release notes from `store/whatsnew/`. No bundle is built or uploaded.
3. Validates the edit, then commits it. It refuses to run if the target track
   already has a newer versionCode than the source.

**Release notes.** `store/whatsnew/<lang>.txt` is the source of truth for the
Play "What's New" text. The file name is the Play language code (`en-US.txt`,
`fa-IR.txt`) and each file must stay within Google's 500-character limit; the
script fails otherwise. Edit these files in a PR before promoting. Every
language in the folder is sent, so add a file to add a language.

The script also runs locally with `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` set; its
header lists the environment variables, including `PLAY_STATUS=inProgress` with
`PLAY_USER_FRACTION` for a staged rollout.

To submit straight to another Play track, change `submit.production.android.track`
in `eas.json` (`internal`, `alpha`, `beta`, `production`).

### App Store prepare-release script (iOS)

`scripts/asc-prepare-release.mjs` stages an App Store version through the App
Store Connect API so that only the final click is left. It **never submits for
review**: it can send four writes (create the version, rename it, set "What's
New", select the build) and refuses every submission or release endpoint.

```bash
ASC_ISSUER_ID=<issuer id> APP_VERSION=1.3.5 BUILD_NUMBER=46 \
  node scripts/asc-prepare-release.mjs
```

Run it locally from the repo root, with the API key from 1.2 on disk
(`ASC_KEY_PATH`, a `.p8` that is never committed). The script header lists every
environment variable; `ASC_DRY_RUN=1` reads and reports without writing.

1. **Version.** Reuses version `APP_VERSION` if it is still editable, otherwise
   creates it. If that version is already waiting for review, in review or
   released, the script stops and changes nothing.
2. **What's New.** Sets the text on every localization the listing already has,
   from `store/whatsnew/<lang>.txt` — the same files the Play promotion uses.
   A locale takes the file with its exact code (`en-US` -> `en-US.txt`), else
   the only file in the same language (`fa` -> `fa-IR.txt`, `en-CA` ->
   `en-US.txt`). A locale with no file in its language is left alone. Apple has
   no "What's New" field on an app's very first version.
3. **Build.** Selects build `BUILD_NUMBER` if it belongs to `APP_VERSION`, has
   finished processing and has not expired; otherwise it says why not.
4. **Readiness.** Re-reads the version and prints its state, the selected
   build, export compliance, per-locale description / keywords / support URL /
   "What's New" / screenshot counts by display size, age rating, category,
   privacy policy URL and review contact, then `READY TO SUBMIT: yes/no` with
   the blockers. The exit code is non-zero only when staging itself failed.

**One open version at a time.** Apple refuses to create a version while another
one is waiting for review or in review ("You cannot create a new version of the
App in the current state"). Either wait until that version is approved and
released, or remove it from review in App Store Connect and rerun with
`ASC_REUSE_EDITABLE=1`, which renames the now-editable version to `APP_VERSION`
instead of creating a second one.

**Submitting (manual).** When the report says `READY TO SUBMIT: yes`: App Store
Connect -> the app -> Distribution -> the version -> check the build, "What's
New" and the release option (manual or automatic after approval) -> **Add for
Review** -> **Submit for Review**. App Privacy answers, pricing and agreements
are not visible to the API, so check those there too.

---

## 7. OTA updates (future option)

Not enabled. JS-only fixes could later ship without a store release via EAS Update:

1. `npx expo install expo-updates`, then `eas update:configure`.
2. Add `"channel": "production"` (and `"preview"`) to the build profiles.
3. Use `runtimeVersion: { "policy": "appVersion" }` or `"fingerprint"`
   (the `nativeVersion` policy is incompatible with the remote version source).
4. Publish with `eas update --channel production --message "..."`, e.g. from a
   workflow on pushes to a `release/*` branch.

Anything that changes native code or config still requires a tagged store release.

---

## 8. Troubleshooting

| Symptom                                                                                | Cause / fix                                                                                                                                                           |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Tag 'vX' does not match the app config version`                                       | `package.json` and app config versions diverged, see [Versioning](#3-versioning)                                                                                      |
| `Repository secret ... is not set`                                                     | Add the secret; secrets are not available to workflows triggered from forks                                                                                           |
| Build fails with "credentials are not set up" / asks for input in non-interactive mode | Run `eas build -p <platform> --profile production` once locally (1.2 step 4 / 1.3 step 4)                                                                             |
| iOS: provisioning profile / certificate expired or invalid                             | Local credentials (1.4): mint a new certificate + profile via the App Store Connect API and replace the files `credentials.json` points at                            |
| iOS build: `credentials.json does not exist` / `credentials.json must exist`           | Copy the ready-made `credentials.json` into the repo root (1.4)                                                                                                       |
| iOS submit: `Set ascAppId in the submit profile`                                       | `ascAppId` missing from `submit.production.ios` in `eas.json` (it is committed; CI also merges the `ASC_APP_ID` secret)                                               |
| iOS submit: authentication / 401 errors                                                | Wrong `ASC_KEY_ID` / `ASC_ISSUER_ID`, revoked key, or the `.p8` was pasted without its `BEGIN`/`END` lines                                                            |
| iOS submit: "bundle version must be higher"                                            | Remote build number is behind the store: `eas build:version:set -p ios`                                                                                               |
| Android submit: "Only releases with status draft may be created on draft app"          | Set variable `PLAY_RELEASE_STATUS=draft` (1.3 step 6)                                                                                                                 |
| Android submit: "package not found" / "caller does not have permission"                | App not created in Play Console, first upload still required (1.3 step 5), service account not invited to the app, or permissions not propagated yet (can take hours) |
| Android submit: "version code has already been used"                                   | `eas build:version:set -p android` to a value above the highest uploaded one                                                                                          |
| `eas.json` rejected by the CLI                                                         | `cli.version` requires EAS CLI >= 16; the workflow installs `latest`. Pin `eas-version` in `release.yml` for full reproducibility                                     |
| Job times out waiting for the build                                                    | EAS queue (free tier); raise `timeout-minutes` or use the `--no-wait --auto-submit` variant (section 5)                                                               |
| Local `eas submit` fails on the `$ASC_API_KEY_PATH` placeholders                       | Export the same variables locally (`ASC_API_KEY_PATH`, `ASC_API_KEY_ID`, `ASC_API_KEY_ISSUER_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`) before running it                |

---

## 9. Reusing this for another app

The workflows contain no app-specific values. Copy and adjust:

- [ ] Copy `eas.json`, `.github/workflows/release.yml`, `.github/workflows/ci.yml`, this file.
- [ ] `package.json` has `lint`, `typecheck` and `test` scripts (drop the `pipeline` job from `ci.yml` if there is no such sub-project).
- [ ] App config: `slug`, `scheme`, `version`, `ios.bundleIdentifier`, `android.package`.
- [ ] `eas init` (new `projectId`), commit the app config change.
- [ ] One interactive `eas build --profile production` per platform to create credentials.
- [ ] App Store Connect app record + API key; Play Console app + service account.
- [ ] Add the seven secrets (section 2); set `APPLE_TEAM_TYPE` / `PLAY_RELEASE_STATUS` variables if needed.
- [ ] EAS environment variables for the `production` environment (`eas env:create`).
- [ ] Protect `v*` tags.
- [ ] `npm version patch && git push --follow-tags`.
