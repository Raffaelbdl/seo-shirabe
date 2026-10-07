// Acceptance cases from the handover (§9), on synthetic fixtures that
// reproduce the myanimetrip audit findings.
import type { Browser } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { homepageSummary, soft404Probe, summarize, type Deps } from '../../src/lib/collect';
import { audit } from '../../src/lib/rules';
import type { AuditReport, PageData, RawAudit, SiteAudit } from '../../src/lib/types';
import { extractRaw, extractRendered, launch } from '../helpers/browser';
import { fetchInfo } from '../helpers/fetch';
import { fixture } from '../helpers/fixtures';

let browser: Browser;
beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser?.close();
});

async function rawAuditOf(name: string, url: string): Promise<RawAudit> {
  const html = fixture(name);
  return { fetch: fetchInfo(url, html), page: await extractRaw(browser, html, url) };
}

const MAT_HOME = 'https://myanimetrip.com/fr';
async function matSite(): Promise<SiteAudit> {
  const home = await rawAuditOf('myanimetrip-home.html', MAT_HOME);
  return { origin: 'https://myanimetrip.com', robots: null, sitemap: null, llms: null, homepage: homepageSummary(home, false) };
}

const titles = (r: AuditReport) => r.findings.map((f) => `${f.severity} ${f.ruleId}: ${f.title}`);
const has = (r: AuditReport, ruleId: string, re?: RegExp) => r.findings.some((f) => f.ruleId === ruleId && (!re || re.test(f.title + ' ' + (f.value ?? ''))));

describe('myanimetrip anime page (Angular)', () => {
  const url = 'https://myanimetrip.com/fr/map/16bit%20Sensation:%20Another%20Layer';
  let report: AuditReport;
  let raw: RawAudit;
  beforeAll(async () => {
    raw = await rawAuditOf('myanimetrip-anime.html', url);
    report = audit({ url, raw, site: await matSite() });
  });

  it('flags hreflang fr / x-default pointing to the homepage', () => {
    expect(has(report, 'hl.points-elsewhere', /All 2 hreflang alternates point to a homepage/)).toBe(true);
    expect(report.findings.find((f) => f.ruleId === 'hl.points-elsewhere')!.severity).toBe('error');
  });
  it('flags the description identical to the homepage', () => {
    expect(has(report, 'meta.description-homepage')).toBe(true);
  });
  it('flags only WebSite JSON-LD and JSON-LD identical to the homepage', () => {
    expect(has(report, 'schema.present', /Only site-wide structured data \(WebSite\)/)).toBe(true);
    expect(has(report, 'schema.homepage')).toBe(true);
  });
  it('measures the ng-state payload (~860 KB) and flags it', () => {
    const ng = raw.page!.framework.find((f) => f.kind === 'angular-ng-state')!;
    expect(ng.bytes).toBeGreaterThan(800 * 1024);
    expect(ng.bytes).toBeLessThan(900 * 1024);
    expect(has(report, 'perf.framework', /Angular TransferState/)).toBe(true);
  });
  it('counts ~400 inline @font-face and flags inline CSS', () => {
    expect(raw.page!.fontFaceCount).toBe(414);
    expect(has(report, 'perf.inline-css', /414 inline @font-face/)).toBe(true);
  });
  it('flags HTML of ~1.3 MB', () => {
    expect(raw.fetch.bytes).toBeGreaterThan(1.1 * 1024 * 1024);
    expect(has(report, 'perf.html-size', /MB/)).toBe(true);
  });
  it('flags the og:image hotlinked from cdn.myanimelist.net', () => {
    expect(has(report, 'share.image-origin', /hotlinked from cdn\.myanimelist\.net/)).toBe(true);
  });
  it('flags the canonical %3A vs : encoding mismatch', () => {
    expect(has(report, 'idx.canonical-target', /differs from the URL by encoding/)).toBe(true);
    expect(has(report, 'idx.canonical-link-encoding', /%3A/)).toBe(true);
  });
  it('is still indexable (the canonical only differs cosmetically)', () => {
    expect(report.indexable).toBe(true);
  });
});

describe('myanimetrip /fr/map list', () => {
  const url = 'https://myanimetrip.com/fr/map';
  it('reports anime items as clickable divs, not links (rendered view)', async () => {
    const html = fixture('myanimetrip-map.html');
    const rendered = await extractRendered(browser, html, url);
    expect(rendered.clickables.length).toBeGreaterThanOrEqual(24);
    const report = audit({ url, rendered: { page: rendered, vitals: null, tabId: 1 } });
    const f = report.findings.find((x) => x.ruleId === 'content.non-crawlable')!;
    expect(f.severity).toBe('warning');
    expect(f.view).toBe('rendered');
    expect(f.value).toMatch(/24× div\.anime-card/);
    expect(f.selector).toBeTruthy();
  });
});

describe('myanimetrip soft 404 probe', () => {
  it('reports 200 + canonical to the homepage for a random URL', async () => {
    const homeHtml = fixture('myanimetrip-home.html');
    const deps: Deps = {
      // The Angular server answers every path with the app shell (status 200).
      fetch: async (u) => ({ info: fetchInfo(u, homeHtml), bytes: new TextEncoder().encode(homeHtml) }),
      parse: (html, u) => extractRaw(browser, html, u),
    };
    const probe = await soft404Probe('https://myanimetrip.com/fr/map/16bit-sensation-another-layer', deps);
    expect(probe.probeUrl).toMatch(/\/fr\/map\/zz-shirabe-404-test-/);
    expect(probe.result.status).toBe(200);
    expect(probe.result.canonical).toBe('https://myanimetrip.com/fr');
    const report = audit({ url: 'https://myanimetrip.com/fr/map/16bit-sensation-another-layer', probes: { soft404: probe } });
    const f = report.findings.find((x) => x.ruleId === 'idx.soft404')!;
    expect(f.severity).toBe('error');
    expect(f.value).toMatch(/canonical: https:\/\/myanimetrip\.com\/fr/);
  });
});

describe('myanimetrip /fr/events', () => {
  const url = 'https://myanimetrip.com/fr/events';
  let report: AuditReport;
  beforeAll(async () => {
    const html = fixture('myanimetrip-events.html');
    const [rawPage, rendered] = await Promise.all([extractRaw(browser, html, url), extractRendered(browser, html, url)]);
    report = audit({ url, raw: { fetch: fetchInfo(url, html), page: rawPage }, rendered: { page: rendered, vitals: null, tabId: 1 } });
  });
  it('reports no links to individual events', () => {
    expect(has(report, 'content.child-links', /No links to detail pages/)).toBe(true);
  });
  it('reports 500+ images hotlinked from third-party domains', () => {
    const f = report.findings.find((x) => x.ruleId === 'img.hotlinked')!;
    expect(f.title).toMatch(/^520 images hotlinked from 6 other domains/);
    expect(f.severity).toBe('warning');
  });
});

describe('myanimetrip blog article (Kamiina Botan) — false-positive guard', () => {
  const url = 'https://myanimetrip.com/fr/blog/kamiina-botan-pelerinage-utsunomiya';
  let report: AuditReport;
  beforeAll(async () => {
    const html = fixture('myanimetrip-blog.html');
    const [rawPage, rendered] = await Promise.all([extractRaw(browser, html, url), extractRendered(browser, html, url)]);
    report = audit({ url, raw: { fetch: fetchInfo(url, html), page: rawPage }, rendered: { page: rendered, vitals: null, tabId: 1 }, site: await matSite() });
  });
  it('has no errors and at most one warning', () => {
    const errorsAndWarnings = report.findings.filter((f) => f.severity !== 'info');
    expect(errorsAndWarnings, titles(report).join('\n')).toHaveLength(0);
  });
  it('recognises the self hreflang and the Article JSON-LD', () => {
    expect(report.passed.map((p) => p.ruleId)).toEqual(expect.arrayContaining(['hl.self', 'hl.points-elsewhere', 'schema.present', 'share.og', 'idx.canonical-target']));
    expect(has(report, 'schema.properties', /Article: missing required/)).toBe(false);
  });
});

describe('seichigo /en/map', () => {
  const url = 'https://www.seichigo.com/en/map';
  it('flags the raw HTML shell (content only after JS)', async () => {
    const html = fixture('seichigo-map.html');
    const [rawPage, rendered] = await Promise.all([extractRaw(browser, html, url), extractRendered(browser, html, url)]);
    expect(rawPage.text).toBe('Loading...');
    expect(rendered.wordCount).toBeGreaterThan(500);
    const report = audit({ url, raw: { fetch: fetchInfo(url, html), page: rawPage }, rendered: { page: rendered, vitals: null, tabId: 1 } });
    const f = report.findings.find((x) => x.ruleId === 'content.shell')!;
    expect(f.severity).toBe('error');
    expect(f.title).toBe('Raw HTML is an empty shell');
    // Also with the raw view only (compare mode)
    const rawOnly = audit({ url, raw: { fetch: fetchInfo(url, html), page: rawPage } });
    expect(has(rawOnly, 'content.shell', /empty shell/)).toBe(true);
  });
});

describe('animepilgrimage anime page — sanity check', () => {
  const url = 'https://animepilgrimage.com/maps/anime/0AvGlAgPpCxpeHIuaJPN/tonikawa';
  let report: AuditReport;
  let page: PageData;
  beforeAll(async () => {
    const html = fixture('animepilgrimage-anime.html');
    page = await extractRaw(browser, html, url);
    report = audit({ url, raw: { fetch: fetchInfo(url, html), page } });
  });
  it('finds hreflang for many languages, FAQ and many internal links', () => {
    expect(new Set(page.headLinks.filter((l) => l.hreflang).map((l) => l.hreflang)).size).toBe(13);
    expect(page.jsonLd.flatMap((b) => b.types)).toEqual(expect.arrayContaining(['FAQPage', 'BreadcrumbList', 'ItemList']));
    expect(page.anchors.filter((a) => a.internal).length).toBeGreaterThanOrEqual(40);
  });
  it('scores high', () => {
    expect(report.findings.filter((f) => f.severity === 'error'), titles(report).join('\n')).toHaveLength(0);
    for (const [cat, score] of Object.entries(report.scores)) expect(score, cat).toBeGreaterThanOrEqual(90);
    expect(report.indexable).toBe(true);
  });
});

describe('summaries', () => {
  it('summarize() reads status, canonical, noindex and hreflang', async () => {
    const r = await rawAuditOf('myanimetrip-home.html', MAT_HOME);
    const s = summarize(r);
    expect(s).toMatchObject({ status: 200, canonical: 'https://myanimetrip.com/fr', noindex: false });
    expect(s.hreflang).toHaveLength(2);
  });
});
