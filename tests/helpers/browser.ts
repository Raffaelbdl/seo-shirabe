// Runs the real extractor in Chromium (same code path as the extension:
// DOMParser for raw HTML, live DOM for the rendered view).
import { chromium, type Browser } from '@playwright/test';
import { existsSync } from 'node:fs';
import { extractPage } from '../../src/lib/extract/extractPage';
import type { PageData } from '../../src/lib/types';

// 1×1 transparent PNG served for every image request (tests stay offline).
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

export function chromiumPath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  return existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
}

export async function launch(): Promise<Browser> {
  return chromium.launch({ executablePath: chromiumPath() });
}

export async function extractRaw(browser: Browser, html: string, url: string): Promise<PageData> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(extractPage, { html, url, view: 'raw' as const });
  } finally {
    await page.close();
  }
}

export async function extractRendered(browser: Browser, html: string, url: string): Promise<PageData> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    await ctx.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (type === 'document') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
      if (type === 'image') return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
      return route.abort();
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'load' });
    return await page.evaluate(extractPage, { html: null, url, view: 'rendered' as const });
  } finally {
    await ctx.close();
  }
}
