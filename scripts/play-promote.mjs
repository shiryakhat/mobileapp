#!/usr/bin/env node
// Promote the build that is already on one Google Play track to another track
// (default: beta -> production) via the Developer API — no deps, no bundle
// upload. The versionCode is reused as-is; only the target track's release and
// its "What's New" notes change. Run by the manual Play Promote workflow; it
// is never run on push or by the Release workflow.
//
// Usage: node scripts/play-promote.mjs
// Env:   GOOGLE_SERVICE_ACCOUNT_KEY_PATH  (service-account JSON)
//        PLAY_PACKAGE        (default: net.shiryakhat.app)
//        SOURCE_TRACK        (default: beta)
//        TARGET_TRACK        (default: production)
//        PLAY_STATUS         (default: completed; "draft" pre-first-review,
//                             "inProgress" for a staged rollout)
//        PLAY_USER_FRACTION  (required with inProgress, e.g. 0.2)
//        WHATSNEW_DIR        (default: store/whatsnew; one <lang>.txt per Play
//                             language code, e.g. en-US.txt, fa-IR.txt)
//        PLAY_DRY_RUN        (1/true: validate the edit, then stop — no commit)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const fail = (...msg) => {
  console.error(...msg);
  process.exit(1);
};

const PKG = process.env.PLAY_PACKAGE || 'net.shiryakhat.app';
const SOURCE = process.env.SOURCE_TRACK || 'beta';
const TARGET = process.env.TARGET_TRACK || 'production';
const STATUS = process.env.PLAY_STATUS || 'completed';
const WHATSNEW_DIR = process.env.WHATSNEW_DIR || 'store/whatsnew';
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.PLAY_DRY_RUN || '');
const NOTE_MAX = 500; // Google Play limit per language, in characters

if (SOURCE === TARGET) fail(`SOURCE_TRACK and TARGET_TRACK are both '${SOURCE}'`);
if (!['completed', 'draft', 'inProgress'].includes(STATUS)) {
  fail(`PLAY_STATUS must be completed, draft or inProgress (got '${STATUS}')`);
}
let userFraction;
if (STATUS === 'inProgress') {
  userFraction = Number(process.env.PLAY_USER_FRACTION);
  if (!(userFraction > 0 && userFraction < 1)) {
    fail('PLAY_STATUS=inProgress needs PLAY_USER_FRACTION between 0 and 1 (e.g. 0.2)');
  }
}

// --- Release notes: every <lang>.txt in WHATSNEW_DIR, filename = Play language code.
if (!fs.existsSync(WHATSNEW_DIR)) fail(`WHATSNEW_DIR '${WHATSNEW_DIR}' not found`);
const releaseNotes = fs
  .readdirSync(WHATSNEW_DIR)
  .filter((f) => f.endsWith('.txt'))
  .sort()
  .map((f) => {
    const language = f.slice(0, -'.txt'.length);
    if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$/.test(language)) {
      fail(`${path.join(WHATSNEW_DIR, f)}: '${language}' is not a Play language code (e.g. en-US)`);
    }
    const text = fs.readFileSync(path.join(WHATSNEW_DIR, f), 'utf8').trim();
    const length = [...text].length;
    if (!length) fail(`${path.join(WHATSNEW_DIR, f)} is empty`);
    if (length > NOTE_MAX) {
      fail(`${path.join(WHATSNEW_DIR, f)} is ${length} characters; Google Play allows ${NOTE_MAX}`);
    }
    return { language, text };
  });
if (!releaseNotes.length) fail(`no <lang>.txt release notes in '${WHATSNEW_DIR}'`);

// --- Auth: service-account JWT -> access token (same as play-upload.mjs).
const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
if (!keyPath || !fs.existsSync(keyPath)) fail('GOOGLE_SERVICE_ACCOUNT_KEY_PATH missing');
const SA = JSON.parse(fs.readFileSync(keyPath, 'utf8'));

const b64u = (b) =>
  Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const now = Math.floor(Date.now() / 1000);
const claim = {
  iss: SA.client_email,
  scope: 'https://www.googleapis.com/auth/androidpublisher',
  aud: 'https://oauth2.googleapis.com/token',
  iat: now,
  exp: now + 3600,
};
const ju = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64u(JSON.stringify(claim));
const sig = crypto.createSign('RSA-SHA256').update(ju).sign(SA.private_key);
const jwt = ju + '.' + b64u(sig);

const tok = await (
  await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
).json();
if (!tok.access_token) fail('auth fail', tok);
const H = { Authorization: 'Bearer ' + tok.access_token };
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}`;

// One Developer API call; any non-2xx aborts the run with Google's message.
// An edit that is never committed changes nothing and simply expires.
async function api(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: body ? { ...H, 'content-type': 'application/json' } : H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    if (text) json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) fail(`${method} ${url} failed (HTTP ${res.status}):`, json.error?.message || text);
  return json;
}

// Highest versionCode that is actually rolled out on a track (drafts and
// halted rollouts are not "released", so they are never promoted).
const liveVersionCode = (track) =>
  (track.releases || [])
    .filter((r) => r.status === 'completed' || r.status === 'inProgress')
    .flatMap((r) => r.versionCodes || [])
    .map(Number)
    .filter(Number.isFinite)
    .reduce((max, v) => Math.max(max, v), 0);
const describe = (track) =>
  JSON.stringify(
    (track.releases || []).map(({ name, status, versionCodes, userFraction: fraction }) => ({
      name,
      status,
      versionCodes,
      userFraction: fraction,
    })),
  );

console.log(
  `package ${PKG}: ${SOURCE} -> ${TARGET} (status ${STATUS})${DRY_RUN ? ' [dry run]' : ''}`,
);
console.log('release notes:', releaseNotes.map((n) => n.language).join(', '));

const edit = await api('POST', '/edits');
if (!edit.id) fail('could not create edit', edit);
console.log('editId', edit.id);

const source = await api('GET', `/edits/${edit.id}/tracks/${SOURCE}`);
const versionCode = liveVersionCode(source);
if (!versionCode) {
  fail(`no released versionCode on track '${SOURCE}' — releases there: ${describe(source)}`);
}
console.log(`versionCode ${versionCode} is live on ${SOURCE}`);

const current = await api('GET', `/edits/${edit.id}/tracks/${TARGET}`);
console.log(`${TARGET} before:`, describe(current));
const currentCode = liveVersionCode(current);
if (currentCode > versionCode) {
  fail(`${TARGET} already has versionCode ${currentCode}, newer than ${versionCode} on ${SOURCE}`);
}
if (currentCode === versionCode) {
  console.log(`versionCode ${versionCode} is already on ${TARGET}; updating status/release notes`);
}

const release = { versionCodes: [String(versionCode)], status: STATUS, releaseNotes };
if (userFraction) release.userFraction = userFraction;
const trk = await api('PUT', `/edits/${edit.id}/tracks/${TARGET}`, {
  track: TARGET,
  releases: [release],
});

await api('POST', `/edits/${edit.id}:validate`);
console.log('edit validated');

if (DRY_RUN) {
  await fetch(`${base}/edits/${edit.id}`, { method: 'DELETE', headers: H }).catch(() => {});
  console.log(`dry run — nothing committed; would promote versionCode ${versionCode} to ${TARGET}`);
} else {
  const commit = await api('POST', `/edits/${edit.id}:commit`);
  if (!commit.id) fail('commit failed', commit);
  console.log('committed editId', commit.id);
  console.log(`promoted versionCode ${versionCode}: ${SOURCE} -> ${TARGET}`);
}
console.log(`${TARGET} releases:`, JSON.stringify(trk.releases || trk, null, 2));
