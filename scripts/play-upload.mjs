#!/usr/bin/env node
// Upload an Android App Bundle to Google Play via the Developer API — no deps,
// no EAS submit queue. Used by the Release workflow (robust against EAS queue jams).
//
// Usage: node scripts/play-upload.mjs <path-to.aab>
// Env:   GOOGLE_SERVICE_ACCOUNT_KEY_PATH  (service-account JSON)
//        PLAY_PACKAGE   (default: net.shiryakhat.app)
//        PLAY_TRACK     (default: internal)
//        PLAY_STATUS    (default: completed; use "draft" pre-first-review)
import fs from 'node:fs';
import crypto from 'node:crypto';

const AAB = process.argv[2];
if (!AAB || !fs.existsSync(AAB)) { console.error('usage: play-upload.mjs <aab>'); process.exit(1); }
const PKG = process.env.PLAY_PACKAGE || 'net.shiryakhat.app';
const TRACK = process.env.PLAY_TRACK || 'internal';
const STATUS = process.env.PLAY_STATUS || 'completed';
const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
if (!keyPath || !fs.existsSync(keyPath)) { console.error('GOOGLE_SERVICE_ACCOUNT_KEY_PATH missing'); process.exit(1); }
const SA = JSON.parse(fs.readFileSync(keyPath, 'utf8'));

const b64u = (b) => Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const now = Math.floor(Date.now() / 1000);
const claim = { iss: SA.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
const ju = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64u(JSON.stringify(claim));
const sig = crypto.createSign('RSA-SHA256').update(ju).sign(SA.private_key);
const jwt = ju + '.' + b64u(sig);

const tok = await (await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
})).json();
if (!tok.access_token) { console.error('auth fail', tok); process.exit(1); }
const H = { Authorization: 'Bearer ' + tok.access_token };
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}`;

const edit = await (await fetch(`${base}/edits`, { method: 'POST', headers: H })).json();
console.log('editId', edit.id);
const up = await (await fetch(
  `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PKG}/edits/${edit.id}/bundles?uploadType=media`,
  { method: 'POST', headers: { ...H, 'content-type': 'application/octet-stream' }, body: fs.readFileSync(AAB) },
)).json();
if (!up.versionCode) { console.error('upload failed', up); process.exit(1); }
console.log('uploaded versionCode', up.versionCode);
const trk = await (await fetch(`${base}/edits/${edit.id}/tracks/${TRACK}`, {
  method: 'PUT', headers: { ...H, 'content-type': 'application/json' },
  body: JSON.stringify({ track: TRACK, releases: [{ versionCodes: [String(up.versionCode)], status: STATUS }] }),
})).json();
console.log('track', TRACK, '->', JSON.stringify(trk.releases || trk).slice(0, 200));
const commit = await (await fetch(`${base}/edits/${edit.id}:commit`, { method: 'POST', headers: H })).json();
if (!commit.id) { console.error('commit failed', commit); process.exit(1); }
console.log('committed editId', commit.id, '— versionCode', up.versionCode, 'on', TRACK);
