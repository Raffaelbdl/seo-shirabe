// Loads the built extension (.output/chrome-mv3-e2e, built with SHIRABE_E2E=1
// so it has host access without the runtime prompt) and audits local pages.
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CompareMetrics } from '../../src/lib/compare';
import type { RawAudit, SiteAudit } from '../../src/lib/types';
import { chromiumPath } from '../helpers/browser';
import { startServer, type FixtureServer } from './server';

const EXT = resolve('.output/chrome-mv3-e2e');
const ANIME = '/fr/map/16bit%20Sensation:%20Another%20Layer';
const BLOG = '/fr/blog/kamiina-botan-pelerinage-utsunomiya';

let ctx: BrowserContext;
let sw: Worker;
let extId: string;
let server: FixtureServer;

test.beforeAll(async () => {
  if (!existsSync(`${EXT}/manifest.json`)) throw new Error('Run `pnpm build:e2e` first');
  server = await startServer();
  ctx = await chromium.launchPersistentContext('', {
    executablePath: chromiumPath(),
    // Playwright's headless shell cannot load extensions: use full Chromium (new headless).
    channel: chromiumPath() ? undefined : 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  extId = new URL(sw.url()).host;
});

test.afterAll(async () => {
  await ctx?.close();
  await server?.close();
});

async function openPanelFor(path: string): Promise<{ site: Page; panel: Page }> {
  const site = await ctx.newPage();
  await site.goto(server.origin + path);
  const tabId = await sw.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => t.url === url)?.id ?? null;
  }, site.url());
  expect(tabId).not.toBeNull();
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html?tabId=${tabId}`);
  return { site, panel };
}

/** Sends a request to the background exactly like the side panel does. */
async function bg<T>(panel: Page, msg: unknown): Promise<T> {
  const res = await panel.evaluate((m) => chrome.runtime.sendMessage(m), msg);
  const env = res as { ok: boolean; data?: T; error?: string };
  if (!env.ok) throw new Error(env.error);
  return env.data as T;
}

test('audits the anime page: raw + rendered, findings in the panel', async () => {
  const { panel, site } = await openPanelFor(ANIME);
  await expect(panel.getByTestId('verdict')).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByText('All 2 hreflang alternates point to a homepage').first()).toBeVisible();
  await expect(panel.getByText('Only site-wide structured data (WebSite)').first()).toBeVisible();
  await expect(panel.getByText(/Angular TransferState \(ng-state\) is \d+ KB/).first()).toBeVisible();
  // site files (homepage comparison) arrive after the first render
  await expect(panel.getByText('Description identical to the homepage').first()).toBeVisible({ timeout: 30_000 });

  await panel.getByRole('tab', { name: 'Raw vs rendered' }).click();
  await expect(panel.getByText('Words', { exact: true })).toBeVisible();

  await panel.getByRole('tab', { name: 'Share' }).click();
  await expect(panel.getByRole('heading', { name: 'X (Twitter)' })).toBeVisible();
  await expect(panel.getByText('image ←').first()).toBeVisible();
  await panel.close();
  await site.close();
});

test('rendered DOM: clickable divs reported as non-crawlable, Show in page works', async () => {
  const { panel, site } = await openPanelFor('/fr/map');
  await expect(panel.getByText(/24 clickable elements without a link/).first()).toBeVisible({ timeout: 30_000 });
  await panel.getByText(/24 clickable elements without a link/).first().click();
  await panel.getByRole('button', { name: 'Show in page' }).first().click();
  await expect(site.locator('[data-shirabe-highlight]')).toHaveCount(1);
  await panel.close();
  await site.close();
});

test('share image is checked and displayed from a blob: URL', async () => {
  const { panel, site } = await openPanelFor(BLOG);
  await expect(panel.getByTestId('verdict')).toBeVisible({ timeout: 30_000 });
  await panel.getByRole('tab', { name: 'Share' }).click();
  await expect(panel.getByText(/1200×630 \(1\.90:1\)/)).toBeVisible({ timeout: 20_000 });
  const src = await panel.locator('.card-facebook img').getAttribute('src');
  expect(src).toMatch(/^blob:chrome-extension:/);
  await panel.close();
  await site.close();
});

test('background: redirect chain, site files, bot User-Agent, compare', async () => {
  const { panel, site } = await openPanelFor(BLOG);

  const redirected = await bg<RawAudit>(panel, { type: 'raw', url: server.origin + '/old' });
  expect(redirected.fetch.finalUrl).toBe(server.origin + ANIME);
  expect(redirected.fetch.redirects.map((h) => h.status)).toEqual([301, 302]);
  expect(redirected.page?.fontFaceCount).toBe(414);

  const siteAudit = await bg<SiteAudit>(panel, { type: 'site', url: server.origin + BLOG, canonical: null });
  expect(siteAudit.robots?.found).toBe(true);
  expect(siteAudit.robots?.agents.find((a) => a.agent === 'GPTBot')?.allowed).toBe(false);
  expect(siteAudit.sitemap?.listed).toBe(true);
  expect(siteAudit.homepage?.title).toContain('MyAnimeTrip');

  const asBot = await bg<RawAudit>(panel, { type: 'raw', url: server.origin + BLOG, botId: 'twitterbot' });
  expect(asBot.page?.titles[0].text).toMatch(/^\[BOT\]/);
  expect(server.userAgents.some((r) => r.path === BLOG && r.ua === 'Twitterbot/1.0')).toBe(true);
  // the UA override is removed afterwards
  const after = await bg<RawAudit>(panel, { type: 'raw', url: server.origin + BLOG });
  expect(after.page?.titles[0].text).not.toMatch(/^\[BOT\]/);
  expect(await sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).toHaveLength(0);

  const metrics = await bg<CompareMetrics[]>(panel, { type: 'compare', urls: [server.origin + ANIME, server.origin + BLOG], rendered: {} });
  expect(metrics).toHaveLength(2);
  expect(metrics[0].frameworkBytes).toBeGreaterThan(800 * 1024);
  expect(metrics[1].schemaTypes).toEqual(expect.arrayContaining(['Article', 'BreadcrumbList']));
  expect(metrics[1].shareImage).toMatchObject({ width: 1200, height: 630, format: 'png' });

  // invalid messages are rejected
  await expect(bg(panel, { type: 'raw', url: 'file:///etc/passwd' })).rejects.toThrow('Invalid request');

  // Web Vitals collector registered for granted origins
  const scripts = await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  expect(scripts.map((s) => s.id)).toContain('shirabe-vitals');
  await panel.close();
  await site.close();
});

test('compare tab: run a set and export', async () => {
  const { panel, site } = await openPanelFor(BLOG);
  await panel.getByRole('tab', { name: 'Compare' }).click();
  await panel.getByLabel('New set name').fill('Local');
  await panel.getByRole('button', { name: 'Create set' }).click();
  await panel.getByRole('button', { name: 'Add current tab' }).click();
  await panel.getByLabel('URL to add').fill(server.origin + ANIME);
  await panel.getByRole('button', { name: 'Add', exact: true }).click();
  await panel.getByRole('button', { name: 'Run comparison' }).click();
  const table = panel.getByTestId('compare-table');
  await expect(table).toBeVisible({ timeout: 30_000 });
  await expect(table.getByText('Framework payload')).toBeVisible();
  // rendered metrics are filled for the URL open in a tab
  await expect(table.locator('tr', { hasText: 'Non-crawlable link candidates' }).locator('td').first()).not.toHaveText(/n\/a/);
  await panel.close();
  await site.close();
});

test('share: metadata streamed into <body> is shown and per-crawler HTML is compared', async () => {
  const { panel, site } = await openPanelFor('/streamed');
  await expect(panel.getByTestId('verdict')).toBeVisible({ timeout: 30_000 });
  await panel.getByRole('tab', { name: 'Share' }).click();
  // browser UA: tags found in <body>, still used for the preview
  await expect(panel.locator('.card-x').getByText('no image')).toHaveCount(0);
  await expect(panel.getByText('(in <body>)').first()).toBeVisible();
  await expect(panel.getByText(/og:\/twitter: tags are only in <body>/)).toBeVisible();
  // per-crawler fetch: X's crawler gets them in <head>
  await panel.getByRole('button', { name: "Fetch as each platform's bot" }).click();
  await expect(panel.getByText('HTML fetched as Twitterbot (X)')).toBeVisible({ timeout: 30_000 });
  const twitterRow = panel.locator('tr', { hasText: 'Twitterbot (X)' });
  await expect(twitterRow.locator('td').nth(3)).toHaveText('0');
  const googleRow = panel.locator('tr', { hasText: 'Googlebot smartphone' });
  await expect(googleRow.locator('td').nth(3)).not.toHaveText('0');
  expect(server.userAgents.some((u) => u.path === '/streamed' && u.ua === 'Twitterbot/1.0')).toBe(true);
  await panel.close();
  await site.close();
});
