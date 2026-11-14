/**
 * Refresh the network-backed caches (website clone + RSS feed) under pipeline/.cache.
 * This is the ONLY pipeline step that needs the network besides `enrich`.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { CACHE_DIR, RSS_CACHE, RSS_URL, WEBSITE_DIR, WEBSITE_REPO } from './config.js';

fs.mkdirSync(CACHE_DIR, { recursive: true });

if (fs.existsSync(`${WEBSITE_DIR}/.git`)) {
  execFileSync('git', ['-C', WEBSITE_DIR, 'pull', '--ff-only', '--quiet'], { stdio: 'inherit' });
} else {
  execFileSync('git', ['clone', '--depth', '1', '--quiet', WEBSITE_REPO, WEBSITE_DIR], {
    stdio: 'inherit',
  });
}
console.log(`website: ${WEBSITE_DIR}`);

const res = await fetch(RSS_URL, { headers: { 'user-agent': 'podcast-client/1.0' } });
if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);
fs.writeFileSync(RSS_CACHE, await res.text());
console.log(`rss: ${RSS_CACHE}`);
