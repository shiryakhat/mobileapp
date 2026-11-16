/**
 * Deep links: the custom scheme and the Universal / App Links
 * (https://shiryakhat.app/episode/<id>?t=<sec>) point at the same episode
 * route, and the website's well-known files match the app's identifiers.
 */
import type { Episode } from '@/content';
import {
  deepLink,
  episodeWebLink,
  resolveIncomingPath,
  shareMessage,
  webLink,
  withTime,
} from '@/lib/links';
import { redirectSystemPath } from '../app/+native-intent';

// The project has no Node typings (it is an app), so the two built-ins used to
// read the website's files are typed by hand.
declare const __dirname: string;
const fs = jest.requireActual<{ readFileSync(file: string, encoding: 'utf8'): string }>('fs');
const read = (file: string) => fs.readFileSync(`${__dirname}/../../${file}`, 'utf8');
const readJson = (file: string) => JSON.parse(read(file));
const ep = {
  id: 's07e07',
  code: 'S07E07',
  youtubeId: 'abc123',
  webUrl: 'https://shiryakhat.net/2025/08/some-episode.html',
} as Episode;

describe('link builders', () => {
  it('builds the custom-scheme link, with whole seconds', () => {
    expect(deepLink('s07e07')).toBe('shiryakhat://episode/s07e07');
    expect(deepLink('s07e07', 0)).toBe('shiryakhat://episode/s07e07');
    expect(deepLink('s07e07', 95.8)).toBe('shiryakhat://episode/s07e07?t=95');
  });

  it('builds the universal link the same way', () => {
    expect(episodeWebLink('s07e07')).toBe('https://shiryakhat.app/episode/s07e07');
    expect(episodeWebLink('s07e07', null)).toBe('https://shiryakhat.app/episode/s07e07');
    expect(episodeWebLink('s07e07', 95.8)).toBe('https://shiryakhat.app/episode/s07e07?t=95');
  });

  it('adds the position to any link, replacing one that is already there', () => {
    expect(withTime('https://a.example/x.html')).toBe('https://a.example/x.html');
    expect(withTime('https://a.example/x.html', 0)).toBe('https://a.example/x.html');
    expect(withTime('https://a.example/x.html', 95.8)).toBe('https://a.example/x.html?t=95');
    expect(withTime('https://a.example/x?m=1&t=3#top', 95)).toBe(
      'https://a.example/x?m=1&t=95#top',
    );
  });

  it('links to the article on the web, or to YouTube without one', () => {
    expect(webLink(ep)).toBe('https://shiryakhat.net/2025/08/some-episode.html');
    expect(webLink(ep, 95.8)).toBe('https://shiryakhat.net/2025/08/some-episode.html?t=95');
    expect(webLink({ ...ep, webUrl: undefined }, 95.8)).toBe('https://youtu.be/abc123?t=95');
  });

  it('shares both links under their labels, each at the same moment', () => {
    const labels = { app: 'Open in the app', web: 'Listen on the web' };
    expect(
      shareMessage({ ep, title: 'Title', quote: 'Q', timeSec: 95.8, timeLabel: '1:35', labels }),
    ).toBe(
      [
        '«Q»',
        'Title — S07E07 · 1:35',
        '',
        'Open in the app:',
        'https://shiryakhat.app/episode/s07e07?t=95',
        'Listen on the web:',
        'https://shiryakhat.net/2025/08/some-episode.html?t=95',
      ].join('\n'),
    );
    // No position: no ?t= anywhere.
    expect(shareMessage({ ep, title: 'Title', labels }).split('\n')).toEqual([
      'Title — S07E07',
      '',
      'Open in the app:',
      'https://shiryakhat.app/episode/s07e07',
      'Listen on the web:',
      'https://shiryakhat.net/2025/08/some-episode.html',
    ]);
  });
});

describe('incoming links', () => {
  it('leaves the episode route alone, for both the scheme and the https origin', () => {
    for (const url of [
      'shiryakhat://episode/s07e07?t=95',
      'https://shiryakhat.app/episode/s07e07?t=95',
      '/episode/s07e07?t=95',
      'shiryakhat://',
      '/',
      '/questions',
    ]) {
      expect(resolveIncomingPath(url)).toBe(url);
    }
  });

  it('maps the short form /e/<id> onto the episode route, keeping the query', () => {
    expect(resolveIncomingPath('https://shiryakhat.app/e/s07e07?t=95')).toBe(
      '/episode/s07e07?t=95',
    );
    expect(resolveIncomingPath('shiryakhat://e/s07e07?t=95')).toBe('/episode/s07e07?t=95');
    expect(resolveIncomingPath('/e/s07e07')).toBe('/episode/s07e07');
    expect(resolveIncomingPath('/e/s07e07/')).toBe('/episode/s07e07');
    expect(resolveIncomingPath('https://shiryakhat.app/e/s07e07?t=95#x')).toBe(
      '/episode/s07e07?t=95',
    );
  });

  it('does not mistake other paths for the short form', () => {
    for (const url of ['/episodes', '/else/e/s07e07', 'https://shiryakhat.app/en/e/s07e07']) {
      expect(resolveIncomingPath(url)).toBe(url);
    }
  });

  it('is wired into expo-router through +native-intent', () => {
    expect(redirectSystemPath({ path: 'https://shiryakhat.app/e/s07e07?t=5', initial: true })).toBe(
      '/episode/s07e07?t=5',
    );
  });
});

describe('app and website association', () => {
  const app = readJson('app.json').expo;

  it('declares the associated domain and verified app links in the app config', () => {
    expect(app.scheme).toBe('shiryakhat');
    expect(app.ios.associatedDomains).toContain('applinks:shiryakhat.app');
    const [filter] = app.android.intentFilters;
    expect(filter).toMatchObject({ action: 'VIEW', autoVerify: true });
    expect(filter.category).toEqual(expect.arrayContaining(['BROWSABLE', 'DEFAULT']));
    expect(filter.data).toEqual([
      { scheme: 'https', host: 'shiryakhat.app', pathPrefix: '/episode/' },
      { scheme: 'https', host: 'shiryakhat.app', pathPrefix: '/e/' },
    ]);
  });

  it('serves an apple-app-site-association for the bundle id, at both locations', () => {
    const aasa = readJson('site/.well-known/apple-app-site-association');
    expect(readJson('site/apple-app-site-association')).toEqual(aasa);
    const [details] = aasa.applinks.details;
    expect(details.appIDs).toHaveLength(1);
    expect(details.appIDs[0]).toMatch(new RegExp(`^[A-Z0-9]{10}\\.${app.ios.bundleIdentifier}$`));
    expect(details.components.map((c: Record<string, string>) => c['/'])).toEqual([
      '/episode/*',
      '/e/*',
    ]);
  });

  it('serves assetlinks.json for the Android package with a real SHA-256 fingerprint', () => {
    const [statement] = readJson('site/.well-known/assetlinks.json');
    expect(statement.relation).toEqual(['delegate_permission/common.handle_all_urls']);
    expect(statement.target.namespace).toBe('android_app');
    expect(statement.target.package_name).toBe(app.android.package);
    expect(statement.target.sha256_cert_fingerprints.length).toBeGreaterThan(0);
    for (const fingerprint of statement.target.sha256_cert_fingerprints) {
      expect(fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    }
  });

  it('keeps the episode landing page and the not-found page identical', () => {
    expect(read('site/episode/index.html')).toBe(read('site/404.html'));
  });
});
