// Service worker: raw HTML fetches (optionally as a bot), offscreen parsing,
// site files, probes and comparison runs. No telemetry, no backend.
import { defineBackground } from 'wxt/utils/define-background';
import { canonicalProbe, hreflangProbe, linksProbe, rawAudit, siteAudit, soft404Probe, type Deps } from '../lib/collect';
import { metricsFrom, type CompareMetrics } from '../lib/compare';
import { validateBgRequest, type BgRequest, type BgResponses, type Envelope } from '../lib/messages';
import { fetchCapped, mapLimit, politeGate, type FetchOptions } from '../lib/net';
import { grantedOrigins, matchesPattern } from '../lib/permissions';
import { audit } from '../lib/rules';
import { checkShareImage } from '../lib/share/images';
import { BOTS, platform } from '../lib/share/platforms';
import { resolveField } from '../lib/share/resolve';
import type { PageData, RawAudit, RedirectHop } from '../lib/types';

const OFFSCREEN_URL = 'offscreen.html';
const UA_RULE_ID = 1;
const VITALS_SCRIPT_ID = 'shirabe-vitals';

export default defineBackground(() => {
  const extOrigin = new URL(chrome.runtime.getURL('/')).origin;

  // The toolbar click opens the panel ourselves (instead of openPanelOnActionClick)
  // so the panel can be told to re-read the tab: the click grants activeTab,
  // which is what reveals the tab URL before the site is granted.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => undefined);
  chrome.action.onClicked.addListener((tab) => {
    // open() must run synchronously inside the user gesture
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
    chrome.runtime.sendMessage({ type: 'shirabe/action-clicked', tabId: tab.id }).catch(() => undefined);
  });

  // ---- redirect chains of our own requests (webRequest, observe only) ------
  const requests = new Map<string, { url: string; start: number; hops: RedirectHop[] }>();
  const ours = (d: { tabId: number; initiator?: string }) => d.tabId === -1 && d.initiator === extOrigin;
  chrome.webRequest.onBeforeRequest.addListener(
    (d) => {
      // A redirect fires onBeforeRequest again with the same requestId: keep the first URL.
      if (!ours(d) || requests.has(d.requestId)) return undefined;
      requests.set(d.requestId, { url: d.url, start: d.timeStamp, hops: [] });
      const cutoff = Date.now() - 120_000;
      for (const [id, r] of requests) if (r.start < cutoff) requests.delete(id);
      return undefined;
    },
    { urls: ['<all_urls>'] },
  );
  chrome.webRequest.onBeforeRedirect.addListener(
    (d) => {
      const r = requests.get(d.requestId);
      if (r) r.hops.push({ url: d.url, status: d.statusCode, location: d.redirectUrl });
    },
    { urls: ['<all_urls>'] },
  );
  const redirectsFor = (url: string, startedAt: number): RedirectHop[] => {
    let best: [string, { url: string; start: number; hops: RedirectHop[] }] | null = null;
    for (const e of requests) if (e[1].url === url && e[1].start >= startedAt - 100 && (!best || e[1].start > best[1].start)) best = e;
    if (!best) return [];
    requests.delete(best[0]);
    return best[1].hops;
  };

  // ---- offscreen DOMParser -------------------------------------------------
  let creating: Promise<void> | null = null;
  async function ensureOffscreen() {
    const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
    if (contexts.length) return;
    creating ??= chrome.offscreen
      .createDocument({ url: OFFSCREEN_URL, reasons: [chrome.offscreen.Reason.DOM_PARSER], justification: 'Parse fetched raw HTML with DOMParser' })
      .finally(() => (creating = null));
    await creating;
  }
  async function parse(html: string, url: string): Promise<PageData> {
    await ensureOffscreen();
    const res = (await chrome.runtime.sendMessage({ target: 'offscreen', type: 'parse', html, url })) as Envelope<PageData> | undefined;
    if (!res) throw new Error('Offscreen parser did not answer');
    if (!res.ok) throw new Error(res.error);
    return res.data;
  }

  // ---- User-Agent override for "fetch as bot" (declarativeNetRequest) ------
  let uaChain: Promise<unknown> = Promise.resolve();
  function withUserAgent<T>(ua: string, fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [UA_RULE_ID],
        addRules: [
          {
            id: UA_RULE_ID,
            priority: 1,
            action: {
              type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
              requestHeaders: [{ header: 'user-agent', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: ua }],
            },
            condition: {
              tabIds: [chrome.tabs.TAB_ID_NONE],
              initiatorDomains: [chrome.runtime.id],
              resourceTypes: [chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST, chrome.declarativeNetRequest.ResourceType.OTHER],
            },
          },
        ],
      });
      try {
        return await fn();
      } finally {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [UA_RULE_ID] });
      }
    };
    const p = uaChain.then(run, run);
    uaChain = p.catch(() => undefined);
    return p;
  }

  const fetcher = (url: string, opts?: FetchOptions) => fetchCapped(url, { redirects: redirectsFor, ...opts });
  const deps: Deps = { fetch: fetcher, parse };

  // Short-lived cache so site checks and probes reuse the page just fetched.
  const rawCache = new Map<string, { at: number; raw: RawAudit }>();
  async function getRaw(url: string, botId?: string): Promise<RawAudit> {
    if (botId) {
      const bot = BOTS.find((b) => b.id === botId);
      if (!bot) throw new Error(`Unknown bot ${botId}`);
      return withUserAgent(bot.userAgent, () => rawAudit(url, { ...deps, fetch: (u, o) => fetcher(u, { ...o, userAgent: bot.label }) }));
    }
    const raw = await rawAudit(url, deps);
    const entry = { at: Date.now(), raw };
    rawCache.set(url, entry);
    rawCache.set(raw.fetch.finalUrl, entry);
    for (const [k, v] of rawCache) if (Date.now() - v.at > 120_000) rawCache.delete(k);
    return raw;
  }
  const cachedRaw = (url: string) => {
    const e = rawCache.get(url);
    return e && Date.now() - e.at < 120_000 ? e.raw : null;
  };

  async function compare(urls: string[], rendered: Record<string, PageData>): Promise<CompareMetrics[]> {
    const gate = politeGate(500);
    const fb = platform('facebook');
    return mapLimit(urls, 2, async (url) => {
      await gate(url);
      const raw = await getRaw(url);
      let image = null;
      if (raw.page) {
        const img = resolveField(raw.page, fb, 'image');
        if (img.value) image = (await checkShareImage(img.value, img.source ?? 'og:image', fetcher)).check;
      }
      const ren = rendered[url] ?? null;
      const report = audit({ url, raw, rendered: ren ? { page: ren, vitals: null, tabId: -1 } : null, images: image ? [image] : [] });
      return metricsFrom(url, raw, report, image, ren);
    });
  }

  async function handle(req: BgRequest): Promise<BgResponses[BgRequest['type']]> {
    switch (req.type) {
      case 'raw':
        return getRaw(req.url, req.botId);
      case 'site':
        return siteAudit(req.url, req.canonical, cachedRaw(req.url), deps);
      case 'probe-soft404':
        return soft404Probe(req.url, deps);
      case 'probe-canonical':
        return canonicalProbe(req.canonical, deps);
      case 'probe-hreflang': {
        const raw = cachedRaw(req.url) ?? (await getRaw(req.url));
        if (!raw.page) throw new Error('No HTML to read hreflang from');
        return hreflangProbe(raw.page, raw.fetch.finalUrl, deps);
      }
      case 'probe-links': {
        const origins = await grantedOrigins();
        return linksProbe(req.urls, deps, { max: req.max, canAccess: (u) => origins.some((p) => matchesPattern(p, u)) });
      }
      case 'compare':
        return compare(req.urls, req.rendered);
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Only our own extension pages (side panel) may call the background.
    // (sender.url is the web page for content scripts, the extension origin for our pages.)
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(`${extOrigin}/`)) return false;
    if (msg && typeof msg === 'object' && (msg as { target?: string }).target === 'offscreen') return false;
    const req = validateBgRequest(msg);
    if (!req) {
      sendResponse({ ok: false, error: 'Invalid request' } satisfies Envelope<never>);
      return false;
    }
    handle(req).then(
      (data) => sendResponse({ ok: true, data }),
      (e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
    return true;
  });

  // ---- Web Vitals content script, registered only for granted origins ------
  async function syncVitalsScript() {
    const origins = await grantedOrigins();
    const matches = origins.some((o) => o === '<all_urls>' || o === '*://*/*') ? ['http://*/*', 'https://*/*'] : origins.filter((o) => /^(https?|\*):\/\//.test(o));
    await chrome.scripting.unregisterContentScripts({ ids: [VITALS_SCRIPT_ID] }).catch(() => undefined);
    if (!matches.length) return;
    await chrome.scripting
      .registerContentScripts([{ id: VITALS_SCRIPT_ID, js: ['content-scripts/vitals.js'], matches, runAt: 'document_start', persistAcrossSessions: true }])
      .catch((e) => console.warn('vitals registration failed', e));
  }
  chrome.permissions.onAdded.addListener(() => void syncVitalsScript());
  chrome.permissions.onRemoved.addListener(() => void syncVitalsScript());
  chrome.runtime.onInstalled.addListener(() => void syncVitalsScript());
  chrome.runtime.onStartup.addListener(() => void syncVitalsScript());
});
