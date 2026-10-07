// Runs the audit on the real pages fetched by `pnpm fixtures:fetch` (git-ignored,
// skipped when absent). The sites change (myanimetrip is being rebuilt), so
// this prints the findings and only asserts what follows from the HTML itself.
import type { Browser } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { audit } from '../../src/lib/rules';
import { extractRaw, launch } from '../helpers/browser';
import { fetchInfo } from '../helpers/fetch';
import { realFixture } from '../helpers/fixtures';

const URLS = 'tests/fixtures/real/urls.json';
const urls: Record<string, { finalUrl: string; status: number }> = existsSync(URLS) ? JSON.parse(readFileSync(URLS, 'utf8')) : {};

describe.skipIf(!Object.keys(urls).length)('real pages (pnpm fixtures:fetch)', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  for (const [file, meta] of Object.entries(urls)) {
    it(file, async () => {
      const html = realFixture(file);
      if (!html) return;
      const page = await extractRaw(browser, html, meta.finalUrl);
      const report = audit({ url: meta.finalUrl, raw: { fetch: fetchInfo(meta.finalUrl, html, { status: meta.status }), page } });
      console.log(`\n${file} (${meta.finalUrl})\n` + report.findings.map((f) => `  ${f.severity.padEnd(7)} ${f.ruleId}: ${f.title}`).join('\n'));
      const ng = page.framework.find((f) => f.kind === 'angular-ng-state');
      if (ng && ng.bytes > 50 * 1024) expect(report.findings.some((f) => f.ruleId === 'perf.framework')).toBe(true);
      if (page.fontFaceCount > 20) expect(report.findings.some((f) => f.ruleId === 'perf.inline-css')).toBe(true);
    });
  }
});
