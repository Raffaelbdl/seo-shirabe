// Message protocol between side panel, background and offscreen document.
// Every incoming message is validated: content scripts and pages are
// untrusted, and even our own contexts get type-checked at the boundary.
import type { CompareMetrics } from './compare';
import type { BrokenLinksProbe, CanonicalProbe, HreflangProbe, PageData, RawAudit, SiteAudit, Soft404Probe, WebVitals } from './types';
import { isHttpUrl } from './url';

export type BgRequest =
  | { type: 'raw'; url: string; botId?: string }
  | { type: 'site'; url: string; canonical: string | null }
  | { type: 'probe-soft404'; url: string }
  | { type: 'probe-canonical'; canonical: string }
  | { type: 'probe-hreflang'; url: string }
  | { type: 'probe-links'; urls: string[]; max: number }
  | { type: 'compare'; urls: string[]; rendered: Record<string, PageData> };

export interface BgResponses {
  raw: RawAudit;
  site: SiteAudit;
  'probe-soft404': Soft404Probe;
  'probe-canonical': CanonicalProbe;
  'probe-hreflang': HreflangProbe;
  'probe-links': BrokenLinksProbe;
  compare: CompareMetrics[];
}

export type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

export interface OffscreenParse {
  target: 'offscreen';
  type: 'parse';
  html: string;
  url: string;
}

const isStr = (v: unknown, max = 10_000): v is string => typeof v === 'string' && v.length <= max;
const isUrl = (v: unknown): v is string => isStr(v, 8192) && isHttpUrl(v);

export function validateBgRequest(m: unknown): BgRequest | null {
  if (!m || typeof m !== 'object') return null;
  const r = m as Record<string, unknown>;
  switch (r.type) {
    case 'raw':
      return isUrl(r.url) && (r.botId === undefined || isStr(r.botId, 64)) ? { type: 'raw', url: r.url, botId: r.botId as string | undefined } : null;
    case 'site':
      return isUrl(r.url) && (r.canonical === null || isUrl(r.canonical)) ? { type: 'site', url: r.url, canonical: r.canonical as string | null } : null;
    case 'probe-soft404':
    case 'probe-hreflang':
      return isUrl(r.url) ? { type: r.type, url: r.url } : null;
    case 'probe-canonical':
      return isUrl(r.canonical) ? { type: 'probe-canonical', canonical: r.canonical } : null;
    case 'probe-links':
      return Array.isArray(r.urls) && r.urls.length <= 5000 && r.urls.every(isUrl) && typeof r.max === 'number' && r.max > 0 && r.max <= 1000
        ? { type: 'probe-links', urls: r.urls, max: r.max }
        : null;
    case 'compare': {
      if (!Array.isArray(r.urls) || r.urls.length > 20 || !r.urls.every(isUrl)) return null;
      const rendered = r.rendered && typeof r.rendered === 'object' ? (r.rendered as Record<string, PageData>) : {};
      for (const [k, v] of Object.entries(rendered)) if (!isUrl(k) || !isPageData(v)) return null;
      return { type: 'compare', urls: r.urls, rendered };
    }
    default:
      return null;
  }
}

/** Background → side panel: the toolbar icon was clicked (activeTab now reveals the tab URL). */
export interface ActionClicked {
  type: 'shirabe/action-clicked';
  windowId: number;
}

export function validateActionClicked(m: unknown): ActionClicked | null {
  const r = m as Partial<ActionClicked> | null;
  return r?.type === 'shirabe/action-clicked' && typeof r.windowId === 'number' ? { type: r.type, windowId: r.windowId } : null;
}

export function validateOffscreen(m: unknown): OffscreenParse | null {
  if (!m || typeof m !== 'object') return null;
  const r = m as Record<string, unknown>;
  if (r.target !== 'offscreen' || r.type !== 'parse' || typeof r.html !== 'string' || !isUrl(r.url)) return null;
  return { target: 'offscreen', type: 'parse', html: r.html, url: r.url };
}

/** Shallow structural check for PageData coming back from an injected script. */
export function isPageData(v: unknown): v is PageData {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.url === 'string' &&
    (p.view === 'raw' || p.view === 'rendered') &&
    Array.isArray(p.metas) &&
    Array.isArray(p.headLinks) &&
    Array.isArray(p.headings) &&
    Array.isArray(p.anchors) &&
    Array.isArray(p.images) &&
    Array.isArray(p.jsonLd) &&
    Array.isArray(p.clickables) &&
    typeof p.text === 'string' &&
    typeof p.wordCount === 'number'
  );
}

/** Vitals reported by the content script: keep finite numbers only. */
export function sanitizeVitals(v: unknown): WebVitals | null {
  if (!v || typeof v !== 'object') return null;
  const out: WebVitals = {};
  for (const k of ['LCP', 'CLS', 'INP', 'TTFB', 'FCP'] as const) {
    const x = (v as Record<string, unknown>)[k];
    if (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x < 1e7) out[k] = x;
  }
  return Object.keys(out).length ? out : null;
}

export async function callBg<T extends BgRequest['type']>(req: Extract<BgRequest, { type: T }>): Promise<BgResponses[T]> {
  const res = (await chrome.runtime.sendMessage(req)) as Envelope<BgResponses[T]> | undefined;
  if (!res) throw new Error('No response from the background worker');
  if (!res.ok) throw new Error(res.error);
  return res.data;
}
