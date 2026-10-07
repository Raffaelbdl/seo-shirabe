// Offscreen document: the service worker has no DOMParser, so raw HTML is
// parsed here. DOMParser documents are inert (no scripts run, no subresources
// load), which makes this safe for untrusted HTML.
import { extractPage } from '../../lib/extract/extractPage';
import { validateOffscreen, type Envelope } from '../../lib/messages';
import type { PageData } from '../../lib/types';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const req = validateOffscreen(msg);
  if (!req) return false;
  try {
    const data = extractPage({ html: req.html, url: req.url, view: 'raw' });
    sendResponse({ ok: true, data } satisfies Envelope<PageData>);
  } catch (e) {
    sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) } satisfies Envelope<PageData>);
  }
  return false;
});
