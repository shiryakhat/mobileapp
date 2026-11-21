#!/usr/bin/env node
// Prepare (stage) an iOS App Store release via the App Store Connect API — no
// deps. It creates or reuses the App Store version, fills in "What's New" from
// store/whatsnew/, selects the TestFlight build, then prints a readiness
// report that ends in "READY TO SUBMIT: yes/no".
//
// It NEVER submits for review. The version is left in "Prepare for Submission"
// and a human presses "Add for Review" in App Store Connect (docs/release.md,
// section 6). The api() helper enforces this: only the four write calls listed
// in WRITE_ALLOW can be sent, and any review-submission / release endpoint is
// refused outright, whatever the method.
//
// Usage: node scripts/asc-prepare-release.mjs     (from the repo root)
// Env:   ASC_KEY_PATH    App Store Connect API key, AuthKey_<KEYID>.p8
//                        (default: /Volumes/Beezhan/secrets/AuthKey_2PALCY787J.p8;
//                         ASC_API_KEY_PATH is also accepted)
//        ASC_KEY_ID      key ID (default: taken from the AuthKey_<KEYID>.p8 file
//                        name; ASC_API_KEY_ID is also accepted)
//        ASC_ISSUER_ID   issuer ID — required (ASC_API_KEY_ISSUER_ID also accepted)
//        ASC_APP_ID      numeric Apple ID of the app (default:
//                        submit.production.ios.ascAppId in eas.json)
//        APP_VERSION     App Store version string (default: 1.3.5)
//        BUILD_NUMBER    TestFlight build number to select (default: 46)
//        WHATSNEW_DIR    release notes, one <lang>.txt per language
//                        (default: store/whatsnew — shared with play-promote.mjs)
//        ASC_REUSE_EDITABLE  1/true: if another version is still editable (for
//                        example one pulled back from review), rename it to
//                        APP_VERSION instead of creating a new one. Off by default.
//        ASC_DRY_RUN     1/true: read-only — report what would change, write nothing
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const fail = (...msg) => {
  console.error(...msg);
  process.exit(1);
};
const flag = (name) => /^(1|true|yes)$/i.test(process.env[name] || '');
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const KEY_PATH =
  process.env.ASC_KEY_PATH ||
  process.env.ASC_API_KEY_PATH ||
  '/Volumes/Beezhan/secrets/AuthKey_2PALCY787J.p8';
const KEY_ID =
  process.env.ASC_KEY_ID ||
  process.env.ASC_API_KEY_ID ||
  (path.basename(KEY_PATH).match(/^AuthKey_([A-Za-z0-9]+)\.p8$/) || [])[1];
const ISSUER_ID = process.env.ASC_ISSUER_ID || process.env.ASC_API_KEY_ISSUER_ID;
const APP_ID = process.env.ASC_APP_ID || readJson('eas.json')?.submit?.production?.ios?.ascAppId;
const APP_VERSION = process.env.APP_VERSION || '1.3.5';
const BUILD_NUMBER = String(process.env.BUILD_NUMBER || '46');
const WHATSNEW_DIR = process.env.WHATSNEW_DIR || 'store/whatsnew';
const REUSE_EDITABLE = flag('ASC_REUSE_EDITABLE');
const DRY_RUN = flag('ASC_DRY_RUN');
const PLATFORM = 'IOS';
const NOTE_MAX = 4000; // App Store limit for "What's New", in characters

if (!fs.existsSync(KEY_PATH)) fail(`ASC_KEY_PATH '${KEY_PATH}' not found`);
if (!KEY_ID) fail('ASC_KEY_ID missing (and the key file is not named AuthKey_<KEYID>.p8)');
if (!ISSUER_ID)
  fail('ASC_ISSUER_ID missing (App Store Connect -> Users and Access -> Integrations)');
if (!/^\d+$/.test(APP_ID || ''))
  fail('ASC_APP_ID missing or not numeric (and no ascAppId in eas.json)');
if (!/^\d+(\.\d+){0,2}$/.test(APP_VERSION)) fail(`APP_VERSION '${APP_VERSION}' is not like 1.2.3`);
if (!/^\d+(\.\d+)*$/.test(BUILD_NUMBER))
  fail(`BUILD_NUMBER '${BUILD_NUMBER}' is not a build number`);

// --- Release notes: every <lang>.txt in WHATSNEW_DIR (same files as Google Play).
if (!fs.existsSync(WHATSNEW_DIR)) fail(`WHATSNEW_DIR '${WHATSNEW_DIR}' not found`);
const notes = fs
  .readdirSync(WHATSNEW_DIR)
  .filter((f) => f.endsWith('.txt'))
  .sort()
  .map((f) => {
    const file = path.join(WHATSNEW_DIR, f);
    const language = f.slice(0, -'.txt'.length);
    const text = fs.readFileSync(file, 'utf8').trim();
    const length = [...text].length;
    if (!length) fail(`${file} is empty`);
    if (length > NOTE_MAX)
      fail(`${file} is ${length} characters; the App Store allows ${NOTE_MAX}`);
    return { language, file, text };
  });
if (!notes.length) fail(`no <lang>.txt release notes in '${WHATSNEW_DIR}'`);

// App Store locale -> notes file. Exact code first (en-US -> en-US.txt), then
// the only file in the same language (fa -> fa-IR.txt, en-CA -> en-US.txt).
// A locale whose language has no file, or several candidates, is left alone.
function noteFor(locale) {
  const lc = locale.toLowerCase();
  const exact = notes.find((n) => n.language.toLowerCase() === lc);
  if (exact) return exact;
  const lang = lc.split('-')[0];
  const sameLanguage = notes.filter((n) => n.language.toLowerCase().split('-')[0] === lang);
  return sameLanguage.length === 1 ? sameLanguage[0] : null;
}

// --- Auth: ES256 JWT signed with the .p8 key, used directly as the bearer token.
const b64u = (b) => Buffer.from(b).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const ju =
  b64u(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' })) +
  '.' +
  b64u(JSON.stringify({ iss: ISSUER_ID, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' }));
let jwt;
try {
  const sig = crypto.sign('sha256', Buffer.from(ju), {
    key: fs.readFileSync(KEY_PATH, 'utf8'),
    dsaEncoding: 'ieee-p1363', // raw r||s, as JWS wants — not DER
  });
  jwt = ju + '.' + b64u(sig);
} catch (e) {
  fail(`could not sign with ${KEY_PATH}: ${e.message}`);
}

const HOST = 'https://api.appstoreconnect.apple.com';
// Never called, with any method: submitting for review, releasing, phased release.
const FORBIDDEN = /submission|releaseRequest|phasedRelease/i;
// The only writes this script can make.
const WRITE_ALLOW = [
  ['POST', /^\/v1\/appStoreVersions$/], // create the version
  ['PATCH', /^\/v1\/appStoreVersions\/[\w-]+$/], // rename it (ASC_REUSE_EDITABLE)
  ['PATCH', /^\/v1\/appStoreVersionLocalizations\/[\w-]+$/], // What's New
  ['PATCH', /^\/v1\/appStoreVersions\/[\w-]+\/relationships\/build$/], // select the build
];

class AscError extends Error {
  constructor(method, url, status, errors, raw) {
    const detail = errors.length
      ? errors.map((e) => `${e.code || e.title}: ${e.detail || e.title}`).join(' | ')
      : raw.slice(0, 500);
    super(`${method} ${url.split('?')[0]} failed (HTTP ${status}): ${detail}`);
    this.status = status;
    this.errors = errors;
  }
}

// One App Store Connect call. Reads are retried on 429/5xx; writes are sent once.
async function api(method, url, body) {
  const pathname = url.replace(HOST, '').split('?')[0];
  if (FORBIDDEN.test(pathname)) throw new Error(`refusing to call ${method} ${pathname}`);
  const isWrite = method !== 'GET';
  if (isWrite && !WRITE_ALLOW.some(([m, re]) => m === method && re.test(pathname))) {
    throw new Error(`refusing write that is not on the allow-list: ${method} ${pathname}`);
  }
  if (isWrite && DRY_RUN) throw new Error(`dry run: ${method} ${pathname} must not be sent`);
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url.startsWith('http') ? url : HOST + url, {
        method,
        headers: {
          Authorization: 'Bearer ' + jwt,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      if (!isWrite && attempt < 3) continue;
      throw new Error(`${method} ${pathname}: network error: ${e.cause?.message || e.message}`);
    }
    const text = await res.text();
    if (!isWrite && attempt < 3 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }
    let json = {};
    try {
      if (text) json = JSON.parse(text);
    } catch {
      /* non-JSON error body: reported raw below */
    }
    if (!res.ok) throw new AscError(method, url, res.status, json.errors || [], text);
    return json;
  }
}
// GET that treats "no such related resource" (404) as null.
const getOrNull = (url) =>
  api('GET', url).catch((e) => {
    if (e.status === 404) return null;
    throw e;
  });
// GET every page of a collection; `included` resources are merged.
async function getAll(url) {
  const data = [];
  const included = [];
  for (let next = url; next;) {
    const page = await api('GET', next);
    data.push(...(page.data || []));
    included.push(...(page.included || []));
    next = page.links?.next;
  }
  return { data, included };
}

// --- App Store version states (appVersionState, falling back to appStoreState).
const stateOf = (v) => v.attributes.appVersionState || v.attributes.appStoreState;
// Metadata and build can still be changed.
const EDITABLE = new Set([
  'PREPARE_FOR_SUBMISSION',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'METADATA_REJECTED',
  'INVALID_BINARY',
]);
// Has been (or is) on the store — the app is past its first release.
const RELEASED = new Set([
  'READY_FOR_SALE',
  'READY_FOR_DISTRIBUTION',
  'PREORDER_READY_FOR_SALE',
  'REPLACED_WITH_NEW_VERSION',
  'REMOVED_FROM_SALE',
  'DEVELOPER_REMOVED_FROM_SALE',
]);

const blockers = []; // would stop a submission
const warnings = []; // worth a look, not blocking
let hardFailure = false; // staging itself did not complete
const block = (msg) => blockers.push(msg);
const ok = (v) => (v ? 'ok' : 'MISSING');
const filled = (v) => typeof v === 'string' && v.trim().length > 0;

console.log(
  `App Store Connect: app ${APP_ID}, version ${APP_VERSION} (${PLATFORM}), build ${BUILD_NUMBER}` +
    (DRY_RUN ? ' [dry run — nothing is written]' : ''),
);
console.log('release notes:', notes.map((n) => n.language).join(', '), `(from ${WHATSNEW_DIR})`);
console.log('this script never submits for review\n');

async function main() {
  const app = (
    await api(
      'GET',
      `/v1/apps/${APP_ID}?fields[apps]=name,bundleId,primaryLocale,contentRightsDeclaration`,
    )
  ).data;
  const primaryLocale = app.attributes.primaryLocale;
  console.log(
    `app: ${app.attributes.name} (${app.attributes.bundleId}), primary locale ${primaryLocale}`,
  );

  // --- 1. The App Store version: reuse an editable one, else create it.
  console.log(`\n[1/4] App Store version ${APP_VERSION}`);
  const versions = (
    await getAll(`/v1/apps/${APP_ID}/appStoreVersions?filter[platform]=${PLATFORM}&limit=200`)
  ).data;
  for (const v of versions)
    console.log(`  existing: ${v.attributes.versionString} — ${stateOf(v)}`);
  if (!versions.length) console.log('  existing: none');
  const everReleased = versions.some((v) => RELEASED.has(stateOf(v)));
  const inFlight = versions.filter(
    (v) => v.attributes.versionString !== APP_VERSION && !RELEASED.has(stateOf(v)),
  );
  const describeInFlight = () =>
    inFlight.map((v) => `${v.attributes.versionString} (${stateOf(v)})`).join(', ');

  let version = versions.find((v) => v.attributes.versionString === APP_VERSION) || null;
  if (version && !EDITABLE.has(stateOf(version))) {
    // Already submitted, in review or released: look, do not touch.
    console.log(`  ${APP_VERSION} is ${stateOf(version)} — not editable, leaving it untouched`);
    block(
      `version ${APP_VERSION} already exists in state ${stateOf(version)}; nothing was changed`,
    );
    hardFailure = true;
    await readiness({ app, version, build: null, everReleased, readOnly: true });
    return;
  }
  if (version) {
    console.log(`  reusing ${APP_VERSION} (${stateOf(version)})`);
  } else {
    const reusable = inFlight.find((v) => EDITABLE.has(stateOf(v)));
    if (reusable && REUSE_EDITABLE) {
      const from = reusable.attributes.versionString;
      if (DRY_RUN) {
        console.log(`  would rename editable version ${from} -> ${APP_VERSION}`);
      } else {
        version = (
          await api('PATCH', `/v1/appStoreVersions/${reusable.id}`, {
            data: {
              type: 'appStoreVersions',
              id: reusable.id,
              attributes: { versionString: APP_VERSION },
            },
          })
        ).data;
        console.log(`  renamed editable version ${from} -> ${APP_VERSION} (${stateOf(version)})`);
      }
    } else if (DRY_RUN) {
      console.log(`  would create version ${APP_VERSION}`);
      if (inFlight.length) {
        console.log(
          `  note: ${describeInFlight()} is still open; Apple normally allows one open version`,
        );
      }
    } else {
      if (inFlight.length) {
        console.log(`  note: ${describeInFlight()} is still open; asking Apple to create anyway`);
      }
      try {
        version = (
          await api('POST', '/v1/appStoreVersions', {
            data: {
              type: 'appStoreVersions',
              attributes: { platform: PLATFORM, versionString: APP_VERSION },
              relationships: { app: { data: { type: 'apps', id: APP_ID } } },
            },
          })
        ).data;
        console.log(`  created ${APP_VERSION} (${stateOf(version)})`);
      } catch (e) {
        if (!(e instanceof AscError)) throw e;
        console.error(`  could not create version ${APP_VERSION}: ${e.message}`);
        hardFailure = true;
        if (!inFlight.length) {
          block(`App Store Connect refused to create version ${APP_VERSION}: ${e.message}`);
        } else if (reusable) {
          block(
            `version ${APP_VERSION} cannot be created while ${describeInFlight()} is open — ` +
              `rerun with ASC_REUSE_EDITABLE=1 to rename that version to ${APP_VERSION}`,
          );
        } else {
          block(
            `version ${APP_VERSION} cannot be created while ${describeInFlight()} is open — ` +
              `wait for it to be approved and released, or remove it from review in App Store ` +
              `Connect and rerun with ASC_REUSE_EDITABLE=1`,
          );
        }
      }
    }
  }

  // --- 2. What's New on every localization the version already has.
  console.log("\n[2/4] What's New");
  if (!version) {
    console.log(`  skipped — there is no version ${APP_VERSION} to write to`);
  } else {
    const locs = (
      await getAll(
        `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations` +
          '?fields[appStoreVersionLocalizations]=locale,whatsNew&limit=200',
      )
    ).data;
    if (!locs.length) console.log('  the version has no localizations');
    for (const loc of locs) {
      const { locale, whatsNew } = loc.attributes;
      const note = noteFor(locale);
      if (!note) {
        console.log(`  ${locale}: no notes file for this language — left as is`);
      } else if ((whatsNew || '').trim() === note.text) {
        console.log(`  ${locale}: already up to date (${note.file})`);
      } else if (DRY_RUN) {
        console.log(`  ${locale}: would set from ${note.file}`);
      } else {
        try {
          await api('PATCH', `/v1/appStoreVersionLocalizations/${loc.id}`, {
            data: {
              type: 'appStoreVersionLocalizations',
              id: loc.id,
              attributes: { whatsNew: note.text },
            },
          });
          console.log(`  ${locale}: set from ${note.file}`);
        } catch (e) {
          if (!(e instanceof AscError)) throw e;
          if (!everReleased && e.status === 409) {
            // Apple has no "What's New" field on an app's very first version.
            console.log(`  ${locale}: not accepted — an app's first version has no What's New`);
          } else {
            console.error(`  ${locale}: FAILED — ${e.message}`);
            hardFailure = true;
          }
        }
      }
    }
    for (const n of notes) {
      if (!locs.some((loc) => noteFor(loc.attributes.locale) === n)) {
        console.log(`  ${n.file}: no matching localization on the listing — not used`);
      }
    }
  }

  // --- 3. The build: must be processed (VALID), not expired, same version train.
  console.log(`\n[3/4] Build ${BUILD_NUMBER}`);
  const found = await getAll(
    `/v1/builds?filter[app]=${APP_ID}&filter[version]=${BUILD_NUMBER}` +
      `&filter[preReleaseVersion.platform]=${PLATFORM}&include=preReleaseVersion` +
      '&fields[builds]=version,processingState,expired,uploadedDate,usesNonExemptEncryption,preReleaseVersion' +
      '&fields[preReleaseVersions]=version,platform&sort=-uploadedDate&limit=50',
  );
  const trainOf = (b) =>
    found.included.find(
      (i) =>
        i.type === 'preReleaseVersions' && i.id === b.relationships?.preReleaseVersion?.data?.id,
    )?.attributes.version;
  const build = found.data.find((b) => trainOf(b) === APP_VERSION) || null;
  let selectable = false;
  if (!build) {
    const others = found.data.map((b) => `${trainOf(b) || '?'} (${b.attributes.version})`);
    block(
      others.length
        ? `build ${BUILD_NUMBER} exists only for version ${others.join(', ')}, not ${APP_VERSION}`
        : `build ${BUILD_NUMBER} not found for this app — not uploaded yet, or Apple is still ingesting it`,
    );
    console.log(`  ${blockers.at(-1)}`);
  } else {
    const { processingState, expired, uploadedDate } = build.attributes;
    console.log(
      `  found ${APP_VERSION} (${BUILD_NUMBER}): ${processingState}` +
        `${expired ? ', EXPIRED' : ''}, uploaded ${uploadedDate}`,
    );
    if (processingState === 'PROCESSING') {
      block(`build ${BUILD_NUMBER} is still processing — rerun when TestFlight shows it as ready`);
    } else if (processingState !== 'VALID') {
      block(`build ${BUILD_NUMBER} is ${processingState} and cannot be selected`);
    } else if (expired) {
      block(`build ${BUILD_NUMBER} has expired and cannot be selected`);
    } else {
      selectable = true;
    }
    if (!selectable) console.log(`  not selected: ${blockers.at(-1)}`);
  }
  if (version && selectable) {
    const current = (
      await getOrNull(`/v1/appStoreVersions/${version.id}/build?fields[builds]=version`)
    )?.data;
    if (current?.id === build.id) {
      console.log(`  already selected on ${APP_VERSION}`);
    } else if (DRY_RUN) {
      console.log(
        `  would select it on ${APP_VERSION} (currently: ${current?.attributes.version || 'none'})`,
      );
    } else {
      try {
        await api('PATCH', `/v1/appStoreVersions/${version.id}/relationships/build`, {
          data: { type: 'builds', id: build.id },
        });
        console.log(`  selected on ${APP_VERSION} (was: ${current?.attributes.version || 'none'})`);
      } catch (e) {
        if (!(e instanceof AscError)) throw e;
        console.error(`  FAILED to select the build — ${e.message}`);
        hardFailure = true;
      }
    }
  } else if (!version && selectable) {
    console.log(`  not selected — there is no version ${APP_VERSION} to attach it to`);
  }

  await readiness({ app, version, build, everReleased, readOnly: false });
}

// --- 4. Readiness: re-read everything from Apple and list what would block a
// submission. Read-only.
async function readiness({ app, version, build, everReleased, readOnly }) {
  console.log('\n[4/4] Readiness check');
  const primaryLocale = app.attributes.primaryLocale;
  const line = (label, value) => console.log(`  ${(label + ':').padEnd(20)} ${value}`);

  if (!version) {
    line('version', `${APP_VERSION} — NOT STAGED`);
    if (DRY_RUN) block(`version ${APP_VERSION} does not exist yet (a dry run does not create it)`);
    if (build) {
      line(
        'build',
        `${BUILD_NUMBER} — ${build.attributes.processingState}, not attached to a version`,
      );
      exportCompliance(build, line);
    }
    return;
  }

  const fresh = await api(
    'GET',
    `/v1/appStoreVersions/${version.id}?include=build,appStoreReviewDetail` +
      '&fields[builds]=version,processingState,expired,usesNonExemptEncryption',
  );
  const v = fresh.data;
  const state = stateOf(v);
  line('version', `${v.attributes.versionString} (${v.attributes.platform}) — ${state}`);
  line('release type', v.attributes.releaseType || 'not set');
  line('copyright', ok(filled(v.attributes.copyright)));
  if (!filled(v.attributes.copyright)) block('copyright is empty');

  // Selected build + export compliance.
  const selected = (fresh.included || []).find((i) => i.type === 'builds');
  if (!selected) {
    line('selected build', 'NONE');
    if (!readOnly) block(`no build is selected on version ${APP_VERSION}`);
  } else {
    const a = selected.attributes;
    line('selected build', `${a.version} — ${a.processingState}${a.expired ? ', EXPIRED' : ''}`);
    if (!readOnly && a.version !== BUILD_NUMBER) {
      block(`version ${APP_VERSION} has build ${a.version} selected, not ${BUILD_NUMBER}`);
    }
    exportCompliance(selected, line);
  }

  // Per-localization metadata and screenshots.
  const locs = (
    await getAll(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=200`)
  ).data;
  const supportsTablet = readJson('app.json')?.expo?.ios?.supportsTablet;
  console.log('  localizations:');
  if (!locs.length) block('the version has no localizations');
  for (const loc of locs) {
    const a = loc.attributes;
    const isPrimary = a.locale === primaryLocale;
    const sets = await getAll(
      `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets` +
        '?include=appScreenshots&fields[appScreenshots]=assetDeliveryState&limit=50&limit[appScreenshots]=50',
    );
    const shots = {};
    for (const set of sets.data) {
      const ids = (set.relationships?.appScreenshots?.data || []).map((d) => d.id);
      const complete = sets.included.filter(
        (i) => ids.includes(i.id) && i.attributes.assetDeliveryState?.state === 'COMPLETE',
      ).length;
      shots[set.attributes.screenshotDisplayType] = { total: ids.length, complete };
    }
    const shotText =
      Object.entries(shots)
        .map(([type, n]) =>
          n.complete === n.total
            ? `${type} x${n.total}`
            : `${type} x${n.total} (${n.complete} processed)`,
        )
        .join(', ') || (isPrimary ? 'NONE' : 'none (falls back to the primary locale)');
    const needsNotes = everReleased; // an app's first version has no What's New
    console.log(`    ${a.locale}${isPrimary ? ' (primary)' : ''}`);
    console.log(
      `      description ${ok(filled(a.description))} | keywords ${ok(filled(a.keywords))} | ` +
        `support URL ${ok(filled(a.supportUrl))} | What's New ` +
        (filled(a.whatsNew)
          ? 'ok'
          : needsNotes
            ? 'MISSING'
            : 'not set (not used on a first version)'),
    );
    console.log(`      screenshots: ${shotText}`);
    for (const [field, label] of [
      ['description', 'description'],
      ['keywords', 'keywords'],
      ['supportUrl', 'support URL'],
    ]) {
      if (!filled(a[field])) block(`${a.locale}: ${label} is missing`);
    }
    if (needsNotes && !filled(a.whatsNew)) block(`${a.locale}: What's New is missing`);
    // Apple needs 6.9"/6.7" or 6.5" iPhone shots, and 13"/12.9" iPad shots for
    // an app that runs on iPad. Other locales inherit the primary locale's set.
    const has = (...types) => types.some((t) => shots[t]?.complete > 0);
    const any = Object.keys(shots).length > 0;
    if (isPrimary || any) {
      if (!has('APP_IPHONE_67', 'APP_IPHONE_65')) {
        block(`${a.locale}: no 6.9"/6.5" iPhone screenshots (APP_IPHONE_67 or APP_IPHONE_65)`);
      }
      if (!has('APP_IPAD_PRO_3GEN_129', 'APP_IPAD_PRO_129')) {
        const msg = `${a.locale}: no 13"/12.9" iPad screenshots (APP_IPAD_PRO_3GEN_129 or APP_IPAD_PRO_129)`;
        if (supportsTablet === true) block(msg);
        else if (supportsTablet !== false)
          warnings.push(`${msg} — required if the app runs on iPad`);
      }
    }
    for (const [type, n] of Object.entries(shots)) {
      if (n.complete < n.total) {
        warnings.push(
          `${a.locale}: ${n.total - n.complete} ${type} screenshot(s) not processed yet`,
        );
      }
    }
  }

  // App-level information: age rating, category, privacy policy, content rights.
  const infos = (await getAll(`/v1/apps/${APP_ID}/appInfos?limit=50`)).data;
  const info =
    infos.find((i) => !RELEASED.has(i.attributes.state || i.attributes.appStoreState)) || infos[0];
  if (!info) {
    block('the app has no App Information record');
  } else {
    const rating = info.attributes.appStoreAgeRating || info.attributes.ageRating;
    line('age rating', rating || 'MISSING');
    if (!rating) block('age rating questionnaire is not completed');
    const category = (await getOrNull(`/v1/appInfos/${info.id}/primaryCategory`))?.data;
    line('primary category', category?.id || 'MISSING');
    if (!category) block('primary category is not set');
    const infoLocs = (await getAll(`/v1/appInfos/${info.id}/appInfoLocalizations?limit=200`)).data;
    const primaryInfo = infoLocs.find((l) => l.attributes.locale === primaryLocale) || infoLocs[0];
    line('app name', ok(filled(primaryInfo?.attributes.name)));
    line('privacy policy URL', ok(filled(primaryInfo?.attributes.privacyPolicyUrl)));
    if (!filled(primaryInfo?.attributes.name)) block('app name is missing');
    if (!filled(primaryInfo?.attributes.privacyPolicyUrl)) block('privacy policy URL is missing');
  }
  line('content rights', app.attributes.contentRightsDeclaration || 'MISSING');
  if (!app.attributes.contentRightsDeclaration) block('content rights declaration is not answered');

  // App Review contact (presence only — the values are personal data).
  const review = (fresh.included || []).find((i) => i.type === 'appStoreReviewDetails')?.attributes;
  const contactOk =
    review &&
    ['contactFirstName', 'contactLastName', 'contactPhone', 'contactEmail'].every((k) =>
      filled(review[k]),
    );
  line('review contact', ok(contactOk));
  if (!contactOk) block('App Review contact information is incomplete');
  if (review?.demoAccountRequired) {
    const demoOk = filled(review.demoAccountName) && filled(review.demoAccountPassword);
    line('demo account', ok(demoOk));
    if (!demoOk) block('a demo account is marked as required but its sign-in details are missing');
  }

  if (!readOnly && state !== 'PREPARE_FOR_SUBMISSION') {
    warnings.push(`version state is ${state}, not PREPARE_FOR_SUBMISSION`);
  }
}

// Export compliance is answered per build (ITSAppUsesNonExemptEncryption in
// Info.plist, or the question in App Store Connect).
function exportCompliance(build, line) {
  const uses = build.attributes.usesNonExemptEncryption;
  if (uses === false) {
    line('export compliance', 'ok — no non-exempt encryption declared');
  } else if (uses === true) {
    line(
      'export compliance',
      'uses non-exempt encryption — check the declaration in App Store Connect',
    );
    warnings.push(
      `build ${build.attributes.version} declares non-exempt encryption; ` +
        'confirm its encryption documentation is approved in App Store Connect',
    );
  } else {
    line('export compliance', 'MISSING');
    block(`export compliance is not answered for build ${build.attributes.version}`);
  }
}

try {
  await main();
} catch (e) {
  hardFailure = true;
  console.error(`\nERROR: ${e.message}`);
  block(`the run stopped on an error: ${e.message}`);
}

console.log('\nNot checkable through the API — confirm in App Store Connect before submitting:');
console.log('  App Privacy answers, pricing and availability, agreements / tax / banking.');
if (warnings.length) {
  console.log('\nWarnings:');
  for (const w of warnings) console.log(`  - ${w}`);
}
console.log(`\nREADY TO SUBMIT: ${blockers.length ? 'no' : 'yes'}${DRY_RUN ? ' (dry run)' : ''}`);
if (blockers.length) {
  console.log('Blockers:');
  for (const b of blockers) console.log(`  - ${b}`);
}
console.log(
  '\nNothing was submitted for review.' +
    (blockers.length
      ? ''
      : ` To submit: App Store Connect -> the app -> Distribution -> ${APP_VERSION} -> Add for Review.`),
);
process.exit(hardFailure ? 1 : 0);
