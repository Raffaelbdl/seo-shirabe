// Data collection that needs the network: raw audit, site files, probes.
// Network and HTML parsing are injected so the logic runs in the service
// worker (fetch + offscreen DOMParser) and in tests (fixtures).
import { decodeText, fetchCapped, gunzip, isHtmlContentType, LIMITS, mapLimit, politeGate, type FetchOptions, type FetchResult } from './net';
import { canonical, description, hasNoindex, hreflangs, robotsDirectives, socialMeta, title, xRobotsDirectives } from './page';
import { AI_BOTS, isAllowed, parseRobots, SEARCH_BOTS } from './robots';
import { jsonLdFingerprint } from './rules/schema';
import { isGzip, parseSitemap } from './sitemap';
import type {
  BrokenLinksProbe,
  CanonicalProbe,
  HomepageSummary,
  HreflangProbe,
  LinkCheck,
  LlmsInfo,
  PageData,
  ProbePageSummary,
  RawAudit,
  RobotsInfo,
  SiteAudit,
  SitemapInfo,
  Soft404Probe,
} from './types';
import { isHomepage, originOf, samePage, soft404ProbeUrl } from './url';

export interface Deps {
  fetch: (url: string, opts?: FetchOptions) => Promise<FetchResult>;
  parse: (html: string, url: string) => Promise<PageData>;
}

export async function rawAudit(url: string, deps: Deps, opts: FetchOptions = {}): Promise<RawAudit> {
  const { info, bytes } = await deps.fetch(url, { maxBytes: LIMITS.htmlBytes, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', ...opts });
  if (!bytes || info.error) return { fetch: info, page: null };
  const text = decodeText(info.contentType, bytes);
  const looksHtml = isHtmlContentType(info.contentType) && (!!info.contentType || /<(!doctype html|html|head|body)[\s>]/i.test(text.slice(0, 2000)));
  if (!looksHtml) return { fetch: info, page: null };
  const page = await deps.parse(text, info.finalUrl);
  return { fetch: info, page };
}

export function summarize(r: RawAudit): ProbePageSummary {
  const p = r.page;
  return {
    url: r.fetch.requestedUrl,
    finalUrl: r.fetch.finalUrl,
    status: r.fetch.status,
    title: p ? title(p) : null,
    canonical: p ? canonical(p) : null,
    noindex: (p ? hasNoindex(robotsDirectives(p)) : false) || hasNoindex(xRobotsDirectives(r.fetch)),
    hreflang: p ? hreflangs(p).map((h) => ({ lang: h.lang, href: h.href ?? h.rawHref })) : [],
    error: r.fetch.error,
  };
}

// ---- site-level files -------------------------------------------------------

export async function robotsAudit(origin: string, url: string, deps: Deps): Promise<RobotsInfo> {
  const robotsUrl = `${origin}/robots.txt`;
  const { info, bytes } = await deps.fetch(robotsUrl, { maxBytes: LIMITS.robotsBytes, accept: 'text/plain,*/*;q=0.5' });
  const base: RobotsInfo = { url: robotsUrl, status: info.status, found: false, error: info.error, sitemaps: [], agents: [], bytes: info.bytes };
  const allAgents = [...SEARCH_BOTS, ...AI_BOTS];
  const allowAll = () => allAgents.map((agent) => ({ agent, allowed: true, rule: null, group: null }));
  if (info.error || !bytes) return { ...base, agents: allowAll() };
  if (info.status >= 400 && info.status < 500) return { ...base, agents: allowAll() };
  if (info.status >= 500) return { ...base, found: true, agents: allAgents.map((agent) => ({ agent, allowed: false, rule: `HTTP ${info.status}`, group: null })) };
  const text = decodeText(info.contentType, bytes);
  if (/^\s*<(!doctype|html)/i.test(text)) return { ...base, error: 'robots.txt returns an HTML page', agents: allowAll() };
  const parsed = parseRobots(text);
  return {
    ...base,
    found: true,
    sitemaps: parsed.sitemaps,
    agents: allAgents.map((agent) => {
      const r = isAllowed(parsed, agent, url);
      return { agent, allowed: r.allowed, rule: r.rule ? `${r.rule.allow ? 'Allow' : 'Disallow'}: ${r.rule.pattern}` : null, group: r.group };
    }),
  };
}

export async function sitemapAudit(origin: string, target: string[], robotsSitemaps: string[], deps: Deps): Promise<SitemapInfo> {
  const queue = robotsSitemaps.length ? [...robotsSitemaps] : [`${origin}/sitemap.xml`];
  const info: SitemapInfo = { checked: [], found: false, listed: false, listedAs: null, alternates: [], urlCount: 0, errors: [], capped: false };
  const seen = new Set<string>();
  let totalBytes = 0;
  const MAX_FILES = 30;
  while (queue.length) {
    const sm = queue.shift()!;
    if (seen.has(sm)) continue;
    seen.add(sm);
    if (seen.size > MAX_FILES || totalBytes >= LIMITS.sitemapTotalBytes) {
      info.capped = true;
      break;
    }
    const { info: fi, bytes } = await deps.fetch(sm, { maxBytes: Math.min(LIMITS.sitemapFileBytes, LIMITS.sitemapTotalBytes - totalBytes), accept: 'application/xml,text/xml,*/*;q=0.5' });
    info.checked.push(sm);
    if (fi.error || !bytes || fi.status !== 200) {
      info.errors.push(`${sm}: ${fi.error ?? `HTTP ${fi.status}`}`);
      continue;
    }
    totalBytes += bytes.byteLength;
    if (fi.truncated) info.capped = true;
    let data = bytes;
    try {
      if (isGzip(bytes)) data = await gunzip(bytes);
    } catch (e) {
      info.errors.push(`${sm}: gzip error ${e instanceof Error ? e.message : ''}`);
      continue;
    }
    const xml = new TextDecoder('utf-8').decode(data);
    const parsed = parseSitemap(xml);
    if (parsed.kind === 'unknown') {
      info.errors.push(`${sm}: not a sitemap`);
      continue;
    }
    info.found = true;
    if (parsed.kind === 'sitemapindex') {
      queue.push(...parsed.sitemaps);
      continue;
    }
    info.urlCount += parsed.urls.length;
    const hit = parsed.urls.find((u) => target.some((t) => samePage(u.loc, t)));
    if (hit) {
      info.listed = true;
      info.listedAs = hit.loc;
      info.alternates = hit.alternates;
      break;
    }
  }
  if (!info.found) info.listed = null;
  return info;
}

export async function llmsAudit(origin: string, deps: Deps): Promise<LlmsInfo> {
  const url = `${origin}/llms.txt`;
  const { info, bytes } = await deps.fetch(url, { maxBytes: LIMITS.llmsBytes, accept: 'text/plain,text/markdown,*/*;q=0.5' });
  const text = bytes ? new TextDecoder().decode(bytes.subarray(0, 512)) : '';
  const present = !info.error && info.status === 200 && !/html/i.test(info.contentType ?? '') && !/^\s*</.test(text);
  return { url, present, status: info.status, bytes: info.bytes };
}

export function homepageSummary(r: RawAudit, isCurrentPage: boolean): HomepageSummary {
  const p = r.page;
  let ogImage = p ? (socialMeta(p, 'og:image')?.value ?? null) : null;
  if (ogImage && p) {
    try {
      ogImage = new URL(ogImage, p.url).href;
    } catch {
      /* keep */
    }
  }
  return {
    url: r.fetch.finalUrl,
    status: r.fetch.status,
    title: p ? title(p) : null,
    description: p ? description(p) : null,
    ogImage,
    jsonLd: p ? jsonLdFingerprint(p) : [],
    isCurrentPage,
  };
}

export async function siteAudit(finalUrl: string, canonicalUrl: string | null, current: RawAudit | null, deps: Deps): Promise<SiteAudit> {
  const origin = originOf(finalUrl);
  if (!origin) return { origin: '', robots: null, sitemap: null, llms: null, homepage: null };
  const robotsP = robotsAudit(origin, finalUrl, deps);
  const llmsP = llmsAudit(origin, deps);
  const homeP = isHomepage(finalUrl) && current ? Promise.resolve(homepageSummary(current, true)) : rawAudit(`${origin}/`, deps).then((r) => homepageSummary(r, samePage(r.fetch.finalUrl, finalUrl)));
  const robots = await robotsP;
  const targets = [canonicalUrl, finalUrl].filter((x): x is string => !!x);
  const sitemap = await sitemapAudit(origin, targets, robots.sitemaps, deps);
  return { origin, robots, sitemap, llms: await llmsP, homepage: await homeP };
}

// ---- probes (opt-in) ---------------------------------------------------------

export async function soft404Probe(url: string, deps: Deps): Promise<Soft404Probe> {
  const probeUrl = soft404ProbeUrl(url);
  return { probeUrl, result: summarize(await rawAudit(probeUrl, deps)) };
}

export async function canonicalProbe(canonicalUrl: string, deps: Deps): Promise<CanonicalProbe> {
  return { canonical: canonicalUrl, result: summarize(await rawAudit(canonicalUrl, deps)) };
}

export async function hreflangProbe(page: PageData, url: string, deps: Deps): Promise<HreflangProbe> {
  const list = hreflangs(page).filter((h) => h.href).slice(0, 40);
  const unique = [...new Map(list.map((h) => [h.href!, h])).values()];
  const gate = politeGate(300);
  const results = await mapLimit(unique, 2, async (h) => {
    await gate(h.href!);
    return summarize(await rawAudit(h.href!, deps));
  });
  const byHref = new Map(unique.map((h, i) => [h.href!, results[i]]));
  const self = canonical(page) ?? url;
  return {
    alternates: list.map((h) => {
      const result = byHref.get(h.href!)!;
      return { lang: h.lang, href: h.href!, result, linksBack: result.hreflang.some((x) => samePage(x.href, self) || samePage(x.href, url)) };
    }),
  };
}

export async function linksProbe(
  urls: string[],
  deps: Pick<Deps, 'fetch'>,
  opts: { max?: number; canAccess?: (url: string) => boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<BrokenLinksProbe> {
  const max = opts.max ?? 150;
  const unique = [...new Set(urls)];
  const list = unique.slice(0, max);
  const gate = politeGate(250);
  let done = 0;
  const checked = await mapLimit(list, 4, async (url): Promise<LinkCheck> => {
    try {
      if (!/^https?:/i.test(url)) return { url, status: 0, ok: false, method: 'HEAD', error: null, skipped: 'not-http' };
      if (opts.canAccess && !opts.canAccess(url)) return { url, status: 0, ok: false, method: 'HEAD', error: null, skipped: 'no-permission' };
      await gate(url);
      let r = await deps.fetch(url, { method: 'HEAD', timeoutMs: 10_000 });
      let method: 'HEAD' | 'GET' = 'HEAD';
      if (r.info.error || [403, 405, 501].includes(r.info.status)) {
        r = await deps.fetch(url, { method: 'GET', maxBytes: 64 * 1024, timeoutMs: 15_000 });
        method = 'GET';
      }
      return { url, status: r.info.status, ok: !r.info.error && r.info.status < 400, method, error: r.info.error };
    } finally {
      opts.onProgress?.(++done, list.length);
    }
  });
  return { checked, capped: unique.length > max };
}

export const defaultDeps = (parse: Deps['parse']): Deps => ({ fetch: fetchCapped, parse });
