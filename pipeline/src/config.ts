import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const PIPELINE_DIR = path.resolve(here, '..');
export const REPO_DIR = path.resolve(PIPELINE_DIR, '..');
export const CACHE_DIR = path.join(PIPELINE_DIR, '.cache');

/** Read-only raw corpus (yt-dlp output + Whisper SRTs). Never written to. */
export const CORPUS_DIR = process.env.SYK_CORPUS_DIR ?? '/Volumes/Beezhan/data/podcasts';
/** Read-only clone of github.com/shiryakhat/website (see `npm run fetch-sources`). */
export const WEBSITE_DIR = process.env.SYK_WEBSITE_DIR ?? path.join(CACHE_DIR, 'website');
export const RSS_CACHE = path.join(CACHE_DIR, 'rss.xml');

export const WEBSITE_REPO = 'https://github.com/shiryakhat/website';
export const RSS_URL = 'https://anchor.fm/s/11aa853c/podcast/rss';

/** archive.org mirrors every upload; the app uses it as a fallback media host. */
export const ARCHIVE_METADATA_URL = 'https://archive.org/metadata';
export const ARCHIVE_DOWNLOAD_URL = 'https://archive.org/download';
/** Item identifiers are `shiryakhat-<youtubeId>` unless overridden below. */
export const ARCHIVE_ID_PREFIX = 'shiryakhat-';
/**
 * Episodes whose archive.org item does not follow the convention, keyed by
 * episode id (e.g. `sp02: 'some-talk-identifier'` for a special that was
 * uploaded to archive.org on its own). Specials can also set `archiveId` in
 * `SPECIALS`.
 */
export const ARCHIVE_ID_OVERRIDES: Record<string, string> = {};

export const CONTENT_DIR = path.join(REPO_DIR, 'content');
export const EPISODES_JSON = path.join(CONTENT_DIR, 'episodes.json');
export const TRANSCRIPTS_DIR = path.join(CONTENT_DIR, 'transcripts');
export const ENRICHMENT_DIR = path.join(CONTENT_DIR, 'enrichment');
export const ENRICHMENT_MANIFEST = path.join(ENRICHMENT_DIR, 'manifest.json');
export const GLOSSARY_JSON = path.join(CONTENT_DIR, 'glossary.json');
export const SEARCH_INDEX_JSON = path.join(CONTENT_DIR, 'search-index.json');
export const GENERATED_TS = path.join(CONTENT_DIR, 'index.generated.ts');

/**
 * Videos whose title carries no (SxxEyy) code but which are a known episode.
 * Keyed by YouTube id.
 */
export const EPISODE_CODE_OVERRIDES: Record<string, string> = {
  FooJ87bP1y8: 'S05E01',
};

/** Videos that are not regular episodes; surfaced as "specials" (season 0). */
export const SPECIALS: Record<
  string,
  { id: string; titleFa: string; titleEn: string; archiveId?: string }
> = {
  vLWps05G_IQ: {
    id: 'sp01',
    titleFa: 'شایان اسکندری، هم‌بنیانگذار شیر یا خط و کوین‌ایران، در برنامه اسکریپت (اپیزود ۱۵)',
    titleEn: 'Shayan Eskandari on the Script show (Episode 15)',
  },
};
