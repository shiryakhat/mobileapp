/**
 * Corpus info.json + website _posts + RSS  ->  content/episodes.json
 * (the archive.org fallback URLs are added afterwards by archive.ts)
 *
 * The corpus has 49 videos for 40 canonical episodes (+1 special): seasons 4-6
 * were uploaded twice (original video + 2025 audio mirror). We dedupe by
 * episode code and keep the alternates in `altYoutubeIds`. The other specials
 * (conference talks) are read from TALKS_DIR.
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import {
  CORPUS_DIR,
  EPISODES_JSON,
  EPISODE_CODE_OVERRIDES,
  RSS_CACHE,
  SPECIALS,
  TALKS_DIR,
  WEBSITE_DIR,
} from './config.js';
import { readJson, readJsonIfExists, writeJson } from './lib/io.js';
import { hasPersian } from './lib/text.js';
import { hasVideoFor } from './lib/video.js';
import type { Chapter, Episode } from './types.js';

interface InfoJson {
  id: string;
  title: string;
  duration: number;
  upload_date: string;
  description?: string;
  chapters?: { start_time: number; end_time: number; title: string }[] | null;
  view_count?: number;
  like_count?: number;
  thumbnail?: string;
}

interface Video {
  stem: string;
  info: InfoJson;
  code?: string;
}

interface Post {
  code: string;
  titleEn: string;
  titleFa: string;
  date: string;
  descriptionFa: string;
  descriptionEn: string;
  keywords: string[];
  spotifyUrl?: string;
  appleUrl?: string;
  castboxUrl?: string;
  webUrl?: string;
}

const CODE = /S(\d{2})E(\d{2})/i;

function requireDir(dir: string, hint: string): void {
  if (!fs.existsSync(dir)) {
    console.error(`Missing ${dir}\n  -> ${hint}`);
    process.exit(1);
  }
}

function readVideos(dir: string): Video[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.info.json') && !f.startsWith('._'))
    .sort()
    .map((f) => {
      const info = readJson<InfoJson>(path.join(dir, f));
      const code = EPISODE_CODE_OVERRIDES[info.id] ?? CODE.exec(info.title)?.[0]?.toUpperCase();
      return { stem: f.slice(0, -'.info.json'.length), info, code };
    });
}

/** The corpus, plus the specials that only exist in TALKS_DIR (conference talks). */
function loadVideos(): Video[] {
  requireDir(CORPUS_DIR, 'mount the corpus or set SYK_CORPUS_DIR');
  const videos = readVideos(CORPUS_DIR);
  const have = new Set(videos.map((v) => v.info.id));
  const wanted = Object.keys(SPECIALS).filter((id) => !have.has(id));
  if (wanted.length === 0) return videos;
  requireDir(TALKS_DIR, 'mount the talks or set SYK_TALKS_DIR');
  const talks = readVideos(TALKS_DIR).filter((v) => wanted.includes(v.info.id));
  for (const id of wanted) {
    if (!talks.some((v) => v.info.id === id)) {
      console.warn(`! special ${SPECIALS[id]!.id} (${id}) not found in the corpus or ${TALKS_DIR}`);
    }
  }
  return [...videos, ...talks];
}

function cleanUrl(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return /^https?:\/\//.test(s) ? s : undefined;
}

function splitTitle(raw: string): { en: string; fa: string } {
  const stripped = raw.replace(/\(?S\d{2}E\d{2}\)?/gi, '').trim();
  const parts = stripped
    .split(/\s*[|｜]\s*/)
    .map((p) => p.replace(/^(شیر\s?یا\s?خط|shir ya khat)\s*[-–:]?\s*/i, '').trim())
    .filter(Boolean);
  const fa = parts.filter(hasPersian).join(' | ');
  const en = parts.filter((p) => !hasPersian(p)).join(' | ');
  return { en, fa };
}

function extractEnSummary(body: string): string {
  const m = /<details class="en-summary"[^>]*>([\s\S]*?)<\/details>/.exec(body);
  if (!m) return '';
  return m[1]!
    .replace(/<summary>[\s\S]*?<\/summary>/, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^https?:\/\//.test(l))
    .join('\n')
    .trim();
}

function loadPosts(): Map<string, Post> {
  const dir = path.join(WEBSITE_DIR, '_posts');
  requireDir(dir, 'run `npm run fetch-sources` (or set SYK_WEBSITE_DIR)');
  const posts = new Map<string, Post>();
  for (const f of fs.readdirSync(dir).sort()) {
    if (!/\.(markdown|md)$/.test(f)) continue;
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
    if (!m) continue;
    let fm: Record<string, unknown>;
    try {
      fm = YAML.parse(m[1]!, { uniqueKeys: false }) as Record<string, unknown>;
    } catch (err) {
      console.warn(`! front-matter parse failed for ${f}: ${(err as Error).message}`);
      continue;
    }
    const title = String(fm.title ?? '');
    const code = (String(fm.episode ?? '') || CODE.exec(title)?.[0] || '').toUpperCase();
    if (!CODE.test(code)) continue;
    const { en, fa } = splitTitle(title);
    const dm = /^(\d{4})-(\d{2})-(\d{2})-(.+)\.(markdown|md)$/.exec(f)!;
    posts.set(code, {
      code,
      titleEn: en,
      titleFa: fa,
      date: `${dm[1]}-${dm[2]}-${dm[3]}`,
      descriptionFa: String(fm.description ?? '').trim(),
      descriptionEn: extractEnSummary(m[2]!),
      keywords: String(fm.keywords ?? '')
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k && k !== 'شیر یا خط'),
      spotifyUrl: cleanUrl(fm.spotify),
      appleUrl: cleanUrl(fm.apple_podcast),
      castboxUrl: cleanUrl(fm.castbox),
      webUrl: `https://shiryakhat.net/${dm[1]}/${dm[2]}/${dm[4]}.html`,
    });
  }
  return posts;
}

/** code -> enclosure url, from the cached public RSS feed. */
function loadRss(): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(RSS_CACHE)) return map;
  const xml = fs.readFileSync(RSS_CACHE, 'utf8');
  for (const item of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
    const title = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/.exec(item)?.[1] ?? '';
    const url = /<enclosure[^>]*url="([^"]+)"/.exec(item)?.[1];
    const code = CODE.exec(title)?.[0]?.toUpperCase();
    if (code && url) map.set(code, url.replace(/&amp;/g, '&'));
  }
  return map;
}

function chaptersOf(info: InfoJson): Chapter[] {
  return (info.chapters ?? []).map((c) => ({
    startSec: Math.round(c.start_time),
    endSec: Math.round(c.end_time),
    title: c.title.trim(),
  }));
}

function thumbOf(info: InfoJson): string {
  const t = info.thumbnail;
  if (t && /i\.ytimg\.com/.test(t)) {
    return t.replace('/vi_webp/', '/vi/').replace(/\.webp(\?.*)?$/, '.jpg');
  }
  return `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`;
}

function isoDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/** Prefer the upload with chapters; then the original (earliest) upload. */
function pickPrimary(videos: Video[]): Video {
  return [...videos].sort((a, b) => {
    const ca = a.info.chapters?.length ? 1 : 0;
    const cb = b.info.chapters?.length ? 1 : 0;
    if (ca !== cb) return cb - ca;
    return a.info.upload_date.localeCompare(b.info.upload_date);
  })[0]!;
}

/**
 * archive.org fallback fields are resolved by the `archive` step (network).
 * Carry the previous build's values over so a rebuild without that step does
 * not drop them — unless the episode now points at another upload.
 */
function archiveFields(
  prev: Episode | undefined,
  youtubeId: string,
  archiveId?: string,
): Pick<Episode, 'archiveId' | 'archiveAudioUrl' | 'archiveVideoUrl'> {
  const same = prev?.youtubeId === youtubeId && (!archiveId || prev.archiveId === archiveId);
  return {
    archiveId: archiveId ?? (same ? prev?.archiveId : undefined),
    archiveAudioUrl: same ? prev?.archiveAudioUrl : undefined,
    archiveVideoUrl: same ? prev?.archiveVideoUrl : undefined,
  };
}

function main(): void {
  const videos = loadVideos();
  const posts = loadPosts();
  const rss = loadRss();
  const previous = new Map(
    (readJsonIfExists<Episode[]>(EPISODES_JSON) ?? []).map((e) => [e.id, e]),
  );
  if (rss.size === 0) console.warn('! no RSS cache; keeping audio URLs from the previous build');

  const groups = new Map<string, Video[]>();
  const episodes: Episode[] = [];

  for (const v of videos) {
    const special = SPECIALS[v.info.id];
    if (special) {
      const description = (v.info.description ?? '').trim();
      episodes.push({
        id: special.id,
        youtubeId: v.info.id,
        altYoutubeIds: [],
        season: 0,
        episode: Number(special.id.replace(/\D/g, '')),
        code: special.id.toUpperCase(),
        titleFa: special.titleFa,
        titleEn: special.titleEn,
        ...(special.conferenceEn ? { conferenceEn: special.conferenceEn } : {}),
        ...(special.conferenceFa ? { conferenceFa: special.conferenceFa } : {}),
        publishedAt: isoDate(v.info.upload_date),
        durationSec: Math.round(v.info.duration),
        chapters: chaptersOf(v.info).length
          ? chaptersOf(v.info)
          : (previous.get(special.id)?.chapters ?? []),
        youtubeThumb: thumbOf(v.info),
        // Talks given in English carry an English description.
        descriptionFa: hasPersian(description) ? description : '',
        descriptionEn: hasPersian(description) ? '' : description,
        keywords: [],
        viewCount: v.info.view_count,
        likeCount: v.info.like_count,
        sourceStem: v.stem,
        ...archiveFields(previous.get(special.id), v.info.id, special.archiveId),
        hasVideo: hasVideoFor({ season: 0, episode: 0 }),
      });
      continue;
    }
    if (!v.code) {
      console.warn(`! skipping video without episode code: ${v.info.id} ${v.info.title}`);
      continue;
    }
    groups.set(v.code, [...(groups.get(v.code) ?? []), v]);
  }

  for (const [code, vids] of groups) {
    const primary = pickPrimary(vids);
    const alts = vids.filter((v) => v !== primary);
    const post = posts.get(code);
    if (!post) console.warn(`! no website post for ${code}; using YouTube metadata`);
    const m = CODE.exec(code)!;
    const id = code.toLowerCase();
    const yt = splitTitle(primary.info.title);
    let chapters = chaptersOf(primary.info);
    if (chapters.length === 0) {
      const donor = alts.find(
        (a) => a.info.chapters?.length && Math.abs(a.info.duration - primary.info.duration) <= 5,
      );
      if (donor) chapters = chaptersOf(donor.info);
    }
    // Preserve hand-authored chapters: when neither YouTube nor a donor upload
    // supplies any, keep whatever the previous build wrote. A rebuild must never
    // wipe locally curated chapters just because the upstream description lacks them.
    if (chapters.length === 0) chapters = previous.get(id)?.chapters ?? [];
    const audioUrl = rss.get(code) ?? previous.get(id)?.audioUrl;
    if (!audioUrl) console.warn(`! no RSS audio for ${code}; app will fall back to YouTube`);
    episodes.push({
      id,
      youtubeId: primary.info.id,
      altYoutubeIds: alts.map((a) => a.info.id),
      season: Number(m[1]),
      episode: Number(m[2]),
      code,
      titleFa: post?.titleFa || yt.fa || yt.en,
      titleEn: post?.titleEn || yt.en || yt.fa,
      publishedAt: post?.date ?? isoDate(primary.info.upload_date),
      durationSec: Math.round(primary.info.duration),
      chapters,
      youtubeThumb: thumbOf(primary.info),
      descriptionFa: post?.descriptionFa || (primary.info.description ?? '').trim(),
      descriptionEn: post?.descriptionEn ?? '',
      keywords: post?.keywords ?? [],
      audioUrl,
      spotifyUrl: post?.spotifyUrl,
      appleUrl: post?.appleUrl,
      castboxUrl: post?.castboxUrl,
      webUrl: post?.webUrl,
      viewCount: vids.reduce((n, v) => n + (v.info.view_count ?? 0), 0),
      likeCount: vids.reduce((n, v) => n + (v.info.like_count ?? 0), 0),
      sourceStem: primary.stem,
      ...archiveFields(previous.get(id), primary.info.id),
      hasVideo: hasVideoFor({ season: Number(m[1]), episode: Number(m[2]) }),
    });
  }

  episodes.sort((a, b) => b.season - a.season || b.episode - a.episode);
  writeJson(EPISODES_JSON, episodes);
  const withAudio = episodes.filter((e) => e.audioUrl).length;
  const withChapters = episodes.filter((e) => e.chapters.length).length;
  console.log(
    `episodes.json: ${episodes.length} episodes from ${videos.length} videos ` +
      `(${withAudio} with RSS audio, ${withChapters} with chapters)`,
  );
}

main();
