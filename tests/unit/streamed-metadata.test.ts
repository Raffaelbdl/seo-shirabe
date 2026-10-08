// Next.js 15.2+ "streaming metadata": for user agents not listed in htmlLimitedBots the
// <title>, meta and link tags are streamed at the end of <body>. Shirabe used to read
// <head> only and reported "no image / nothing" on share cards for such pages.
import type { Browser } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { description, headTagsInBody, socialMeta } from '../../src/lib/page';
import { audit } from '../../src/lib/rules';
import { platform } from '../../src/lib/share/platforms';
import { resolvePreview } from '../../src/lib/share/resolve';
import type { AuditReport, RawAudit } from '../../src/lib/types';
import { extractRaw, launch } from '../helpers/browser';
import { fetchInfo } from '../helpers/fetch';
import { fixture } from '../helpers/fixtures';

let browser: Browser;
beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser?.close();
});

const url = 'https://myanimetrip.com/fr/map/16bit-sensation-another-layer';

describe('metadata streamed into <body>', () => {
  let raw: RawAudit;
  let report: AuditReport;
  beforeAll(async () => {
    const html = fixture('nextjs-streamed-metadata.html');
    raw = { fetch: fetchInfo(url, html), page: await extractRaw(browser, html, url) };
    report = audit({ url, raw });
  });

  it('still reads og/twitter tags and the description, marked as outside <head>', () => {
    const p = raw.page!;
    expect(socialMeta(p, 'og:image')).toEqual({ value: `${url}/opengraph-image`, attr: 'property', inHead: false });
    expect(socialMeta(p, 'twitter:card')?.value).toBe('summary_large_image');
    expect(description(p)).toMatch(/^16bit Sensation/);
    // tags that are in <head> still report inHead: true
    expect(resolvePreview(p, platform('discord')).themeColor).toEqual({ value: '#c62828', source: 'meta:theme-color', inHead: true });
  });

  it('builds share previews with an image instead of "no image"', () => {
    const x = resolvePreview(raw.page!, platform('x'));
    expect(x.image.value).toBe(`${url}/opengraph-image`);
    expect(x.image.inHead).toBe(false);
    expect(x.cardType).toBe('summary_large_image');
    const fb = resolvePreview(raw.page!, platform('facebook'));
    expect(fb.description.source).toBe('og:description');
    expect(fb.description.inHead).toBe(false);
  });

  it('lists the misplaced tags and ignores microdata', () => {
    const tags = headTagsInBody(raw.page!).map((t) => t.tag);
    expect(tags).toContain('title');
    expect(tags).toContain('link rel="canonical"');
    expect(tags).toContain('meta property="og:image"');
    expect(tags.some((t) => t.includes('itemprop') || t.includes('"name"'))).toBe(false);
    expect(headTagsInBody(raw.page!).find((t) => t.tag === 'link rel="canonical"')?.indexing).toBe(true);
  });

  it('reports the placement instead of "missing" findings', () => {
    const ids = report.findings.map((f) => f.ruleId);
    expect(ids).toContain('meta.head-in-body');
    expect(ids).toContain('share.meta-in-body');
    const og = report.findings.filter((f) => f.ruleId === 'share.og');
    expect(og.some((f) => /og:image missing/.test(f.title))).toBe(false);
    expect(report.findings.some((f) => f.ruleId === 'meta.title' && /missing/i.test(f.title))).toBe(false);
    const idx = report.findings.find((f) => f.ruleId === 'meta.head-in-body' && f.severity === 'error');
    expect(idx?.value).toContain('link rel="canonical"');
  });
});
