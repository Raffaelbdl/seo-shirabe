// Interaction with the inspected tab (rendered DOM, Web Vitals, "Show in page").
import { extractPage } from '../../lib/extract/extractPage';
import { isPageData, sanitizeVitals } from '../../lib/messages';
import type { PageData, WebVitals } from '../../lib/types';

export async function extractRendered(tabId: number, url: string): Promise<PageData> {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractPage,
    args: [{ html: null, url, view: 'rendered' as const }],
  });
  // The result comes from the page's renderer: treat as untrusted, check shape.
  if (!res || !isPageData(res.result)) throw new Error('Could not read the rendered page');
  return res.result;
}

export async function getVitals(tabId: number): Promise<WebVitals | null> {
  try {
    const v = await chrome.tabs.sendMessage(tabId, { type: 'shirabe/vitals' });
    return sanitizeVitals(v);
  } catch {
    return null; // content script not injected (page loaded before access was granted)
  }
}

/** Scrolls to and outlines an element in the inspected tab. Self-contained (injected). */
function highlightInPage(selector: string): boolean {
  const ID = 'shirabe-highlight-style';
  let el: Element | null = null;
  try {
    el = document.querySelector(selector);
  } catch {
    return false;
  }
  if (!el) return false;
  if (!document.getElementById(ID)) {
    const st = document.createElement('style');
    st.id = ID;
    st.textContent =
      '[data-shirabe-highlight]{outline:3px solid #e8590c !important;outline-offset:2px !important;box-shadow:0 0 0 6px rgba(232,89,12,.25) !important;}';
    document.documentElement.appendChild(st);
  }
  document.querySelectorAll('[data-shirabe-highlight]').forEach((x) => x.removeAttribute('data-shirabe-highlight'));
  el.setAttribute('data-shirabe-highlight', '');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => el && el.removeAttribute('data-shirabe-highlight'), 4000);
  return true;
}

export async function showInPage(tabId: number, selector: string): Promise<boolean> {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: highlightInPage, args: [selector] });
  return res?.result === true;
}
