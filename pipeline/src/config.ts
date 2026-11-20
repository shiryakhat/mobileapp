import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const PIPELINE_DIR = path.resolve(here, '..');
export const REPO_DIR = path.resolve(PIPELINE_DIR, '..');
export const CACHE_DIR = path.join(PIPELINE_DIR, '.cache');

/** Read-only raw corpus (yt-dlp output + Whisper SRTs). Never written to. */
export const CORPUS_DIR = process.env.SYK_CORPUS_DIR ?? '/Volumes/Beezhan/data/podcasts';
/**
 * Read-only assets of the specials that are not podcast uploads (conference
 * talks): same yt-dlp + Whisper layout as the corpus. Only videos listed in
 * `SPECIALS` are read from here; a special found in the corpus wins.
 */
export const TALKS_DIR = process.env.SYK_TALKS_DIR ?? '/Volumes/Beezhan/data/talks';
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
  {
    id: string;
    titleFa: string;
    titleEn: string;
    /** Where the talk was given; the app shows it with the date instead of "SP<n>". */
    conferenceEn?: string;
    conferenceFa?: string;
    archiveId?: string;
  }
> = {
  vLWps05G_IQ: {
    id: 'sp01',
    titleFa: 'شایان اسکندری، هم‌بنیانگذار شیر یا خط و کوین‌ایران، در برنامه اسکریپت (اپیزود ۱۵)',
    titleEn: 'Shayan Eskandari on the Script show (Episode 15)',
    conferenceEn: 'Script show',
    conferenceFa: 'برنامه اسکریپت',
  },
  // Shayan's conference talks, numbered by upload date. Sourced from TALKS_DIR
  // and played from YouTube; set `archiveId` once a talk is on archive.org.
  JfryEnYvX54: {
    id: 'sp02',
    titleFa: 'آشنایی با بیت‌کوین - دانشگاه شهید بهشتی',
    titleEn: 'Introduction to Bitcoin (Shahid Beheshti University)',
    conferenceEn: 'Shahid Beheshti University',
    conferenceFa: 'دانشگاه شهید بهشتی',
  },
  tVgto0GtA4I: {
    id: 'sp03',
    titleFa: 'تقلب شفاف: رده‌بندی فرانت‌رانینگ در بلاکچین (دِوکان ۵)',
    titleEn:
      'Transparent Dishonesty: Blockchain Front-Running Taxonomy by Shayan Eskandari (Devcon5)',
    conferenceEn: 'Devcon 5',
    conferenceFa: 'دِوکان ۵',
  },
  'Zs-P5FSJvGQ': {
    id: 'sp04',
    titleFa: 'شکستن قراردادهای هوشمند (دِوکان ۵)',
    titleEn: 'Breaking Smart Contracts (Devcon5)',
    conferenceEn: 'Devcon 5',
    conferenceFa: 'دِوکان ۵',
  },
  'VaqIFiY-Ks0': {
    id: 'sp05',
    titleFa: 'بیت‌کوین چطور پول را به اقتصادهای بسته می‌برد و از آن‌ها بیرون می‌آورد',
    titleEn: 'How Bitcoin Moves Value In & Out Of Closed Economies',
    conferenceEn: 'DeFi Discussions',
    conferenceFa: 'DeFi Discussions',
  },
  '4AS64fSeRtA': {
    id: 'sp06',
    titleFa: 'اوراکل‌ها، از واقعیت بیرونی تا دست‌کاری بازار (Liquidity 2020)',
    titleEn:
      'Oracles from the Ground Truth to Market Manipulation - Shayan Eskandari - Liquidity2020',
    conferenceEn: 'Liquidity 2020',
    conferenceFa: 'Liquidity 2020',
  },
  gfD1KBtLWZI: {
    id: 'sp07',
    titleFa: 'امنیت از مرحلهٔ طراحی و ممیزی قراردادهای هوشمند',
    titleEn: 'Security By Design & Smart Contract Audits | Shayan Eskandari',
    conferenceEn: 'C4',
    conferenceFa: 'C4',
  },
  'JaLv-iesrB0': {
    id: 'sp08',
    titleFa: 'بیت‌کوین یا اتریوم؟',
    titleEn: 'Bitcoin vs. Ethereum?',
    conferenceEn: 'C4 Live',
    conferenceFa: 'C4 Live',
  },
  vzufW0SQOI8: {
    id: 'sp09',
    titleFa: 'الفبای امنیت عملیاتی',
    titleEn: 'Operational Security 101',
    conferenceEn: 'C4 Live',
    conferenceFa: 'C4 Live',
  },
  '1ZFe_7ehlWw': {
    id: 'sp10',
    titleFa: 'آشنایی با دائوها',
    titleEn: 'Introduction to DAOs',
    conferenceEn: 'C4 Live',
    conferenceFa: 'C4 Live',
  },
  G2_MJtbSe1s: {
    id: 'sp11',
    titleFa: 'وب۳ در دنیای واقعی و تحریم‌ها (Autonomous Ecologies #1)',
    titleEn: 'Shayan Eskandari - IRL Web3 and Sanctions [Autonomous Ecologies #1]',
    conferenceEn: 'Autonomous Ecologies #1',
    conferenceFa: 'Autonomous Ecologies #1',
  },
  wI6zxfUxMI4: {
    id: 'sp12',
    titleFa: 'پنل: ارزش قابل استخراج از اوراکل؛ مدل‌های درآمدی تازه و پایداری اوراکل‌ها و دَپ‌ها',
    titleEn:
      'PANEL: Oracle Extractable Value: Unlocking New Revenue Models and Sustainability for Oracles & Dapps',
    conferenceEn: 'DeFiConnect',
    conferenceFa: 'DeFiConnect',
  },
  '3DDA_6l0wLQ': {
    id: 'sp13',
    titleFa: 'ساختن در دل محدودیت‌ها: یک دهه وب۳ در ایران',
    titleEn: 'Building Through Constraints: A Decade of Web3 in Iran',
    conferenceEn: 'Devcon 8',
    conferenceFa: 'دِوکان ۸',
  },
  'p1bklAl3-BQ': {
    id: 'sp14',
    titleFa: 'کدنویسی از سر خشم و مادرِ همهٔ وی‌پی‌ان‌ها: یادداشت‌هایی از قطعی‌های اینترنت ایران',
    titleEn: "Rage-Coding the Mother of All VPNs: Notes from Iran's Internet Blackouts",
    conferenceEn: 'Devcon 8',
    conferenceFa: 'دِوکان ۸',
  },
  // Added after sp02-sp14, so it takes the next number although it dates from 2020.
  'mSmp_-z3UOg': {
    id: 'sp15',
    titleFa: 'تقلب شفاف: حمله‌های فرانت‌رانینگ در بلاکچین (کنفرانس بلاکچین استنفورد ۲۰۲۰)',
    titleEn:
      'Transparent Dishonesty: front-running attacks on Blockchain (Stanford Blockchain Conference 2020)',
    conferenceEn: 'Stanford Blockchain Conference 2020',
    conferenceFa: 'کنفرانس بلاکچین استنفورد ۲۰۲۰',
  },
};
