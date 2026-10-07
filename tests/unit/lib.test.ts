import { describe, expect, it } from 'vitest';
import { robotsAudit, sitemapAudit, linksProbe, type Deps } from '../../src/lib/collect';
import { bestColumns, METRIC_ROWS, pushRun, toCsv, toMarkdown, type CompareMetrics, type CompareRun } from '../../src/lib/compare';
import { readImageHeader } from '../../src/lib/imageInfo';
import { isPageData, sanitizeVitals, validateBgRequest } from '../../src/lib/messages';
import { decodeText, sniffCharset } from '../../src/lib/net';
import { matchesPattern, originPatternFor } from '../../src/lib/permissions';
import { textWidthPx, truncateChars, truncateToPx } from '../../src/lib/pixels';
import { isAllowed, parseRobots } from '../../src/lib/robots';
import { validateHreflang } from '../../src/lib/rules/hreflang';
import { platformImageIssues } from '../../src/lib/share/images';
import { BOTS, platform, PLATFORMS, FIELD_TOKENS } from '../../src/lib/share/platforms';
import { parseSitemap } from '../../src/lib/sitemap';
import type { Category, ShareImageCheck } from '../../src/lib/types';
import { compareUrls, isHomeLike, registrableDomain, samePage, soft404ProbeUrl } from '../../src/lib/url';
import { fetchInfo } from '../helpers/fetch';

describe('url', () => {
  it('classifies cosmetic URL differences', () => {
    expect(compareUrls('https://a.com/x%3Ay', 'https://a.com/x:y')).toBe('encoding');
    expect(compareUrls('https://a.com/x/', 'https://a.com/x')).toBe('trailing-slash');
    expect(compareUrls('https://a.com/X', 'https://a.com/x')).toBe('case');
    expect(compareUrls('https://www.a.com/x', 'https://a.com/x')).toBe('www');
    expect(compareUrls('http://a.com/x', 'https://a.com/x')).toBe('protocol');
    expect(compareUrls('https://a.com/x', 'https://a.com/y')).toBe('different');
    expect(samePage('https://a.com/x#top', 'https://a.com/x/')).toBe(true);
  });
  it('recognises homepages and language roots', () => {
    expect(isHomeLike('https://a.com/')).toBe(true);
    expect(isHomeLike('https://a.com/fr')).toBe(true);
    expect(isHomeLike('https://a.com/en-us/')).toBe(true);
    expect(isHomeLike('https://a.com/fr/map')).toBe(false);
    expect(isHomeLike('https://a.com/map')).toBe(false);
  });
  it('computes registrable domains', () => {
    expect(registrableDomain('cdn.myanimelist.net')).toBe('myanimelist.net');
    expect(registrableDomain('www.example.co.uk')).toBe('example.co.uk');
  });
  it('builds the soft-404 probe URL', () => {
    expect(soft404ProbeUrl('https://a.com/fr/map/x?y=1', 'abc')).toBe('https://a.com/fr/map/zz-shirabe-404-test-abc');
    expect(soft404ProbeUrl('https://a.com/', 'abc')).toBe('https://a.com/zz-shirabe-404-test-abc');
    expect(soft404ProbeUrl('https://a.com/blog/', 'abc')).toBe('https://a.com/zz-shirabe-404-test-abc');
  });
});

describe('robots.txt', () => {
  const robots = parseRobots(`
User-agent: *
Disallow: /admin
Allow: /admin/public

User-agent: GPTBot
User-agent: CCBot
Disallow: /

User-agent: Googlebot
Disallow: /*.pdf$
Sitemap: https://a.com/sitemap.xml
`);
  it('applies the most specific group and the longest rule', () => {
    expect(isAllowed(robots, 'Bingbot', 'https://a.com/admin/x').allowed).toBe(false);
    expect(isAllowed(robots, 'Bingbot', 'https://a.com/admin/public/x').allowed).toBe(true);
    expect(isAllowed(robots, 'Googlebot', 'https://a.com/admin/x').allowed).toBe(true); // own group, no /admin rule
    expect(isAllowed(robots, 'Googlebot', 'https://a.com/file.pdf').allowed).toBe(false);
    expect(isAllowed(robots, 'Googlebot', 'https://a.com/file.pdf?x').allowed).toBe(true);
    expect(isAllowed(robots, 'CCBot', 'https://a.com/').allowed).toBe(false);
    expect(robots.sitemaps).toEqual(['https://a.com/sitemap.xml']);
  });
  it('robotsAudit treats 404 as allow-all and 5xx as disallow-all', async () => {
    const mk = (status: number, body = ''): Deps => ({
      fetch: async (u) => ({ info: fetchInfo(u, body, { status, ok: status < 400, contentType: 'text/plain' }), bytes: new TextEncoder().encode(body) }),
      parse: async () => {
        throw new Error('unused');
      },
    });
    const r404 = await robotsAudit('https://a.com', 'https://a.com/x', mk(404));
    expect(r404.found).toBe(false);
    expect(r404.agents.every((a) => a.allowed)).toBe(true);
    const r503 = await robotsAudit('https://a.com', 'https://a.com/x', mk(503));
    expect(r503.agents.every((a) => !a.allowed)).toBe(true);
    const ok = await robotsAudit('https://a.com', 'https://a.com/admin', mk(200, 'User-agent: *\nDisallow: /admin\n'));
    expect(ok.agents.find((a) => a.agent === 'Googlebot')).toMatchObject({ allowed: false, rule: 'Disallow: /admin' });
  });
});

describe('sitemaps', () => {
  const index = `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://a.com/s1.xml.gz</loc></sitemap></sitemapindex>`;
  const urlset = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
<url><loc>https://a.com/fr/map/16bit%20Sensation%3A%20Another%20Layer</loc><xhtml:link rel="alternate" hreflang="en" href="https://a.com/en/map/x"/></url>
<url><loc>https://a.com/a&amp;b</loc></url></urlset>`;
  it('parses urlsets with alternates and entities', () => {
    const p = parseSitemap(urlset);
    expect(p.kind).toBe('urlset');
    expect(p.urls[1].loc).toBe('https://a.com/a&b');
    expect(p.urls[0].alternates).toEqual([{ hreflang: 'en', href: 'https://a.com/en/map/x' }]);
  });
  it('follows sitemap indexes and gunzips', async () => {
    const gz = new Uint8Array(await new Response(new Blob([urlset]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    const deps: Deps = {
      fetch: async (u) => (u.endsWith('.gz') ? { info: fetchInfo(u, ''), bytes: gz } : { info: fetchInfo(u, index), bytes: new TextEncoder().encode(index) }),
      parse: async () => {
        throw new Error('unused');
      },
    };
    const s = await sitemapAudit('https://a.com', ['https://a.com/fr/map/16bit%20Sensation:%20Another%20Layer'], ['https://a.com/sitemap_index.xml'], deps);
    expect(s).toMatchObject({ found: true, listed: true, urlCount: 2 });
    expect(s.checked).toEqual(['https://a.com/sitemap_index.xml', 'https://a.com/s1.xml.gz']);
    expect(s.alternates).toHaveLength(1);
  });
});

describe('image headers', () => {
  it('reads PNG, GIF, JPEG and WebP dimensions', () => {
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAABLAAAAJ2CAIAAAA=', 'base64'));
    expect(readImageHeader(png)).toEqual({ format: 'png', width: 1200, height: 630 });
    const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0x00, 0x20, 0x00]);
    expect(readImageHeader(gif)).toEqual({ format: 'gif', width: 16, height: 32 });
    // JPEG: SOI, APP0 (len 4), SOF0 with 630x1200
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x76, 0x04, 0xb0, 0x03]);
    expect(readImageHeader(jpeg)).toEqual({ format: 'jpeg', width: 1200, height: 630 });
    const webp = new Uint8Array(30);
    webp.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
    webp.set([...'WEBPVP8X'].map((c) => c.charCodeAt(0)), 8);
    webp.set([0xaf, 0x04, 0x00, 0x75, 0x02, 0x00], 24); // 1199+1, 629+1
    expect(readImageHeader(webp)).toEqual({ format: 'webp', width: 1200, height: 630 });
    expect(readImageHeader(new TextEncoder().encode('<svg viewBox="0 0 64 32"></svg>'))).toEqual({ format: 'svg', width: 64, height: 32 });
  });
});

describe('share platform rules', () => {
  it('every rule file is complete, sourced and dated', () => {
    for (const p of PLATFORMS) {
      expect(p.source.length, p.platform).toBeGreaterThan(0);
      expect(p.lastVerified, p.platform).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const tokens of Object.values(p.fields)) for (const t of tokens) expect(t, `${p.platform}: ${t}`).toMatch(FIELD_TOKENS);
    }
    expect(BOTS.map((b) => b.id)).toEqual(expect.arrayContaining(['googlebot-smartphone', 'twitterbot', 'facebookexternalhit', 'telegrambot', 'discordbot', 'whatsapp', 'slackbot-linkexpanding', 'linkedinbot']));
  });
  it('checks share images against platform limits', () => {
    const c: ShareImageCheck = { url: 'https://a.com/i.webp', source: 'og:image', https: true, status: 200, contentType: 'image/webp', bytes: 900_000, format: 'webp', width: 800, height: 800, host: 'a.com', error: null };
    const wa = platformImageIssues(c, platform('whatsapp')).map((i) => i.text).join(' | ');
    expect(wa).toMatch(/exceeds/);
    const li = platformImageIssues(c, platform('linkedin')).map((i) => i.text).join(' | ');
    expect(li).toMatch(/WEBP/);
    expect(li).toMatch(/below the 1200×627 minimum/);
    expect(platformImageIssues(c, platform('x'), 'summary').some((i) => /cropped/.test(i.text))).toBe(false);
    expect(platformImageIssues(c, platform('x'), 'summary_large_image').some((i) => /cropped to 2:1/.test(i.text))).toBe(true);
  });
});

describe('hreflang codes', () => {
  it('validates language and region', () => {
    expect(validateHreflang('fr')).toBeNull();
    expect(validateHreflang('x-default')).toBeNull();
    expect(validateHreflang('zh-Hant')).toBeNull();
    expect(validateHreflang('pt-BR')).toBeNull();
    expect(validateHreflang('en-UK')).toMatch(/gb/);
    expect(validateHreflang('uk')).toBeNull(); // Ukrainian
    expect(validateHreflang('jp')).toMatch(/country code/);
    expect(validateHreflang('en_US')).toMatch(/separator/);
  });
});

describe('pixels', () => {
  it('estimates widths and truncates', () => {
    expect(textWidthPx('iiii', 20)).toBeLessThan(textWidthPx('MMMM', 20));
    const long = 'A very long title that will certainly not fit into the Google desktop title link width at all';
    const t = truncateToPx(long, 20, 600);
    expect(t.truncated).toBe(true);
    expect(t.text.endsWith('...')).toBe(true);
    expect(truncateChars('abcdef', 4)).toEqual({ text: 'abc…', truncated: true });
  });
});

describe('permissions', () => {
  it('matches patterns and builds origin patterns', () => {
    expect(matchesPattern('<all_urls>', 'https://x.com/a')).toBe(true);
    expect(matchesPattern('https://a.com/*', 'https://a.com/x?y')).toBe(true);
    expect(matchesPattern('https://a.com/*', 'https://b.a.com/x')).toBe(false);
    expect(matchesPattern('*://*.a.com/*', 'http://b.a.com/x')).toBe(true);
    expect(originPatternFor('http://localhost:4173/x')).toBe('http://localhost/*');
  });
});

describe('messages', () => {
  it('validates background requests', () => {
    expect(validateBgRequest({ type: 'raw', url: 'https://a.com' })).toEqual({ type: 'raw', url: 'https://a.com', botId: undefined });
    expect(validateBgRequest({ type: 'raw', url: 'javascript:alert(1)' })).toBeNull();
    expect(validateBgRequest({ type: 'site', url: 'https://a.com', canonical: 'file:///etc/passwd' })).toBeNull();
    expect(validateBgRequest({ type: 'probe-links', urls: ['https://a.com'], max: 1e6 })).toBeNull();
    expect(validateBgRequest({ type: 'compare', urls: ['https://a.com'], rendered: { 'https://a.com': { nope: 1 } } })).toBeNull();
    expect(validateBgRequest({ type: 'nope' })).toBeNull();
    expect(isPageData({ url: 'x' })).toBe(false);
  });
  it('sanitises vitals', () => {
    expect(sanitizeVitals({ LCP: 1200, CLS: 'x', INP: -1, TTFB: Infinity, evil: 3 })).toEqual({ LCP: 1200 });
    expect(sanitizeVitals('nope')).toBeNull();
  });
});

describe('charset', () => {
  it('sniffs from header and meta', () => {
    expect(sniffCharset('text/html; charset=Shift_JIS', new Uint8Array())).toBe('Shift_JIS');
    expect(sniffCharset('text/html', new TextEncoder().encode('<meta charset="euc-jp">'))).toBe('euc-jp');
    const sjis = Uint8Array.from([0x82, 0xa0]); // あ in Shift_JIS
    expect(decodeText('text/html; charset=shift_jis', sjis)).toBe('あ');
  });
});

describe('broken links probe', () => {
  it('falls back to GET, skips origins without access, caps the list', async () => {
    const calls: string[] = [];
    const deps = {
      fetch: async (u: string, o?: { method?: string }) => {
        calls.push(`${o?.method} ${u}`);
        if (u.endsWith('/405')) return { info: fetchInfo(u, '', { status: o?.method === 'HEAD' ? 405 : 200 }), bytes: null };
        if (u.endsWith('/404')) return { info: fetchInfo(u, '', { status: 404, ok: false }), bytes: null };
        return { info: fetchInfo(u, ''), bytes: null };
      },
    };
    const r = await linksProbe(['https://a.com/ok', 'https://a.com/405', 'https://a.com/404', 'https://b.com/x', 'https://a.com/ok'], deps, { canAccess: (u) => u.startsWith('https://a.com'), max: 10 });
    expect(r.checked.map((c) => [c.url, c.ok, c.skipped ?? null])).toEqual([
      ['https://a.com/ok', true, null],
      ['https://a.com/405', true, null],
      ['https://a.com/404', false, null],
      ['https://b.com/x', false, 'no-permission'],
    ]);
    expect(calls).toContain('GET https://a.com/405');
  });
});

describe('compare', () => {
  const scores = { indexability: 100, meta: 90, hreflang: 100, content: 80, images: 100, schema: 70, share: 100, performance: 60, ai: 100 } as Record<Category, number>;
  const m = (url: string, extra: Partial<CompareMetrics>): CompareMetrics => ({
    url, finalUrl: url, status: 200, error: null, indexable: true, indexabilityReasons: [], title: 'T', description: 'D', h1: 'H', h1Count: 1,
    canonical: url, canonicalSelf: true, hreflangLangs: [], schemaTypes: [], ogPresent: [], ogMissing: [], shareImage: null, rawWords: 100,
    renderedWords: null, htmlBytes: 1000, frameworkBytes: 0, inlineCssBytes: 0, fontFaceCount: 0, internalLinks: 10, nonCrawlable: null,
    images: 0, imagesNoAlt: 0, scores, errors: 0, warnings: 0, ...extra,
  });
  const run: CompareRun = { id: 'r1', setId: 's', at: Date.UTC(2026, 9, 7), results: [m('https://a.com/x', { htmlBytes: 1_300_000 }), m('https://b.com/y|z', { htmlBytes: 40_000 })] };
  it('highlights the best column', () => {
    const html = METRIC_ROWS.find((r) => r.key === 'html')!;
    expect(bestColumns(html, run.results)).toEqual([1]);
    const status = METRIC_ROWS.find((r) => r.key === 'status')!;
    expect(bestColumns(status, run.results)).toEqual([]); // all equal
  });
  it('exports Markdown and CSV', () => {
    const md = toMarkdown({ name: 'Anime hubs' }, run);
    expect(md).toContain('| Metric | a.com/x | b.com/y\\|z |');
    expect(md).toContain('**39 KB**');
    expect(toCsv(run).split('\n')[0]).toBe('metric,https://a.com/x,https://b.com/y|z');
  });
  it('keeps the last N runs', () => {
    let h: CompareRun[] = [];
    for (let i = 0; i < 15; i++) h = pushRun(h, { ...run, id: `r${i}` });
    expect(h).toHaveLength(10);
    expect(h[0].id).toBe('r14');
  });
});
