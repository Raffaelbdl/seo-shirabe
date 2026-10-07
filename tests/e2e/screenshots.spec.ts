// Regenerates the README screenshots in docs/screenshots/ from the real
// extension on the synthetic fixture pages: pnpm screenshots
// Skipped in the normal e2e run.
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { resolve } from 'node:path';
import { chromiumPath } from '../helpers/browser';
import { startServer, type FixtureServer } from './server';

test.skip(!process.env.SHIRABE_SCREENSHOTS, 'run with pnpm screenshots');

const EXT = resolve('.output/chrome-mv3-e2e');
const OUT = resolve('docs/screenshots');
const HOST = 'demo.shirabe.test';
const ANIME = '/fr/map/16bit%20Sensation:%20Another%20Layer';
const BLOG = '/fr/blog/kamiina-botan-pelerinage-utsunomiya';

let ctx: BrowserContext;
let sw: Worker;
let server: FixtureServer;

test.beforeAll(async () => {
  server = await startServer(`http://${HOST}`);
  ctx = await chromium.launchPersistentContext('', {
    executablePath: chromiumPath(),
    channel: chromiumPath() ? undefined : 'chromium',
    headless: true,
    colorScheme: 'light',
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--host-resolver-rules=MAP ${HOST} 127.0.0.1:${server.port}`],
  });
  sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
});

test.afterAll(async () => {
  await ctx?.close();
  await server?.close();
});

async function panelFor(path: string): Promise<Page> {
  const site = await ctx.newPage();
  await site.goto(server.origin + path);
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)?.id, site.url());
  const panel = await ctx.newPage();
  await panel.setViewportSize({ width: 420, height: 860 });
  await panel.goto(`chrome-extension://${new URL(sw.url()).host}/sidepanel.html?tabId=${tabId}`);
  await expect(panel.getByTestId('verdict')).toBeVisible({ timeout: 30_000 });
  await panel.waitForTimeout(1500); // site files and share images arrive after the first render
  return panel;
}

async function scrollTo(panel: Page, heading: RegExp | string) {
  await panel.getByRole('heading', { name: heading }).evaluate((el) => {
    el.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -80); // below the sticky tab bar
  });
}

async function shot(panel: Page, tab: string, name: string) {
  await panel.getByRole('tab', { name: tab }).click();
  await panel.waitForTimeout(300);
  await panel.screenshot({ path: `${OUT}/${name}.png` });
}

test('screenshots', async () => {
  test.setTimeout(120_000);
  const anime = await panelFor(ANIME);
  await shot(anime, 'Overview', 'overview');
  await shot(anime, 'Tech', 'tech');

  const blog = await panelFor(BLOG);
  await shot(blog, 'Share', 'share');

  const list = await panelFor('/fr/map');
  await list.getByRole('tab', { name: 'Content' }).click();
  await scrollTo(list, /Clickable elements without a link/);
  await list.screenshot({ path: `${OUT}/content.png` });

  const shell = await panelFor('/en/map');
  await shot(shell, 'Raw vs rendered', 'raw-vs-rendered');

  await blog.getByRole('tab', { name: 'Compare' }).click();
  await blog.getByLabel('New set name').fill('Demo');
  await blog.getByRole('button', { name: 'Create set' }).click();
  await blog.getByRole('button', { name: 'Add current tab' }).click();
  await blog.getByLabel('URL to add').fill(server.origin + ANIME);
  await blog.getByRole('button', { name: 'Add', exact: true }).click();
  await blog.getByRole('button', { name: 'Run comparison' }).click();
  await expect(blog.getByTestId('compare-table')).toBeVisible({ timeout: 30_000 });
  await blog.setViewportSize({ width: 820, height: 860 }); // the table needs a wider panel
  await scrollTo(blog, 'Results');
  await blog.screenshot({ path: `${OUT}/compare.png` });
});
