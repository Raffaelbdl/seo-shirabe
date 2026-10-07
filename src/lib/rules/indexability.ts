import { canonicals, hasNoindex, robotsDirectives, xRobotsDirectives } from '../page';
import type { PageData } from '../types';
import { compareUrls, decodeSafe, isAbsoluteHttp, isHomeLike, samePage, safeUrl } from '../url';
import { plural, type Rule } from './engine';

const DOCS = {
  status: 'https://developers.google.com/search/docs/crawling-indexing/http-network-errors',
  redirects: 'https://developers.google.com/search/docs/crawling-indexing/301-redirects',
  noindex: 'https://developers.google.com/search/docs/crawling-indexing/block-indexing',
  robots: 'https://developers.google.com/search/docs/crawling-indexing/robots/intro',
  canonical: 'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
  sitemap: 'https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview',
  soft404: 'https://developers.google.com/search/docs/crawling-indexing/http-network-errors#soft-404-errors',
};

function canonicalOf(p: PageData) {
  return canonicals(p)[0] ?? null;
}

export const indexabilityRules: Rule[] = [
  {
    id: 'idx.status',
    category: 'indexability',
    view: 'raw',
    title: 'Page returns HTTP 200',
    why: 'Only pages that return 200 can be indexed. 4xx pages are dropped, 5xx slow down crawling and are dropped if they persist.',
    fix: 'Make the URL return 200, or redirect it (301) to the right page.',
    docs: DOCS.status,
    check: ({ fetch }) => {
      if (!fetch) return null;
      if (fetch.error) return [{ severity: 'error', title: 'Raw HTML could not be fetched', value: fetch.error, blocksIndexing: false }];
      if (fetch.status === 200) return [];
      return [{ severity: 'error', title: `HTTP status ${fetch.status}`, value: `${fetch.status} ${fetch.statusText}`.trim(), blocksIndexing: true }];
    },
  },
  {
    id: 'idx.not-html',
    category: 'indexability',
    view: 'raw',
    title: 'Response is HTML',
    why: 'The audit and social scrapers expect an HTML document.',
    fix: 'Serve the page with Content-Type: text/html.',
    check: ({ fetch, raw }) => {
      if (!fetch || fetch.error || fetch.status !== 200) return null;
      if (raw) return [];
      return [{ severity: 'warning', title: 'Response is not HTML', value: fetch.contentType ?? 'no Content-Type' }];
    },
  },
  {
    id: 'idx.redirects',
    category: 'indexability',
    view: 'raw',
    title: 'No redirect chain',
    why: 'Each redirect hop costs crawl budget and latency; Google follows up to 10 hops but long chains dilute signals and break social scrapers (some follow only one or two).',
    fix: 'Link directly to the final URL and make the first redirect point to the final destination.',
    docs: DOCS.redirects,
    check: ({ fetch }) => {
      if (!fetch || fetch.error) return null;
      const hops = fetch.redirects;
      if (hops.length === 0) return [];
      const chain = [...hops.map((h) => `${h.status || '3xx'} ${h.url}`), `→ ${fetch.finalUrl}`].join('\n');
      if (hops.length > 1) return [{ severity: 'warning', title: `Redirect chain with ${hops.length} hops`, value: chain }];
      return [{ severity: 'info', title: 'URL redirects once', value: chain, fix: 'Fine for old URLs; update internal links to point at the final URL.' }];
    },
  },
  {
    id: 'idx.noindex-meta',
    category: 'indexability',
    view: 'raw',
    title: 'No noindex robots meta',
    why: 'A noindex directive removes the page from search results.',
    fix: 'Remove the noindex directive if the page should be found in search.',
    docs: DOCS.noindex,
    check: ({ raw, rendered }) => {
      if (!raw && !rendered) return null;
      const hits = [];
      const rawNo = raw ? hasNoindex(robotsDirectives(raw)) : false;
      const renNo = rendered ? hasNoindex(robotsDirectives(rendered)) : false;
      if (rawNo)
        hits.push({ severity: 'error' as const, title: 'noindex in robots meta', value: robotsDirectives(raw!).join(', '), blocksIndexing: true, view: 'raw' as const });
      else if (renNo)
        hits.push({
          severity: 'error' as const,
          title: 'noindex added by JavaScript',
          value: robotsDirectives(rendered!).join(', '),
          why: 'Google renders JavaScript and honours a noindex added at runtime; it may also skip rendering pages that are noindex in the raw HTML.',
          blocksIndexing: true,
          view: 'rendered' as const,
        });
      if (rawNo && rendered && !renNo)
        hits.push({
          severity: 'warning' as const,
          title: 'noindex in raw HTML is removed by JavaScript',
          value: 'raw: noindex · rendered: indexable',
          why: 'Google may not render a page whose raw HTML says noindex, so removing it with JavaScript does not work.',
          fix: 'Serve the final robots meta in the raw HTML.',
          view: 'rendered' as const,
        });
      return hits;
    },
  },
  {
    id: 'idx.noindex-header',
    category: 'indexability',
    view: 'raw',
    title: 'No noindex X-Robots-Tag header',
    why: 'An X-Robots-Tag: noindex HTTP header removes the page from search results, even if the HTML looks fine.',
    fix: 'Remove noindex from the X-Robots-Tag header (check the server, CDN and framework config).',
    docs: DOCS.noindex,
    check: ({ fetch }) => {
      if (!fetch || fetch.error) return null;
      const d = xRobotsDirectives(fetch);
      if (hasNoindex(d)) return [{ severity: 'error', title: 'noindex in X-Robots-Tag header', value: d.join(', '), blocksIndexing: true }];
      return [];
    },
  },
  {
    id: 'idx.robots-txt',
    category: 'indexability',
    view: 'site',
    title: 'Allowed by robots.txt for Googlebot',
    why: 'A URL blocked by robots.txt cannot be crawled; it may still appear in results without a snippet, and noindex / canonical tags on it are never seen.',
    fix: 'Change the Disallow rule that matches this URL, or move the page.',
    docs: DOCS.robots,
    check: ({ site }) => {
      const r = site?.robots;
      if (!r || !r.found) return null;
      const hits = [];
      for (const a of r.agents.filter((x) => x.agent === 'Googlebot' || x.agent === 'Bingbot')) {
        if (!a.allowed)
          hits.push({
            severity: 'error' as const,
            title: `Blocked by robots.txt for ${a.agent}`,
            value: `${a.rule} (group "${a.group}")`,
            blocksIndexing: a.agent === 'Googlebot',
          });
      }
      if (r.status >= 500)
        hits.push({
          severity: 'error' as const,
          title: `robots.txt returns ${r.status}`,
          value: r.url,
          why: 'When robots.txt returns a server error, Google stops crawling the site until it gets a valid response.',
          fix: 'Make /robots.txt return 200 (or 404 if you have no rules).',
          blocksIndexing: true,
        });
      return hits;
    },
  },
  {
    id: 'idx.canonical-missing',
    category: 'indexability',
    view: 'raw',
    title: 'Canonical link present',
    why: 'Without a canonical, Google picks one itself among duplicate URLs (tracking parameters, trailing slash, http/https…).',
    fix: 'Add <link rel="canonical" href="https://…/this-page"> with the absolute, final URL of the page.',
    docs: DOCS.canonical,
    check: ({ pick }) => {
      const p = pick('raw');
      if (!p) return null;
      const all = canonicals(p.page, false);
      if (all.length === 0) return [{ severity: 'warning', title: 'No canonical link', view: p.view }];
      return [];
    },
  },
  {
    id: 'idx.canonical-multiple',
    category: 'indexability',
    view: 'raw',
    title: 'Single canonical link',
    why: 'With several (different) canonicals, or a canonical outside <head>, Google ignores them all.',
    fix: 'Keep exactly one rel=canonical, inside <head>.',
    docs: DOCS.canonical,
    check: ({ pick }) => {
      const p = pick('raw');
      if (!p) return null;
      const all = canonicals(p.page, false);
      const hits = [];
      const distinct = new Set(all.map((c) => c.href));
      if (distinct.size > 1)
        hits.push({ severity: 'error' as const, title: `${all.length} different canonical links`, value: [...distinct].join('\n'), view: p.view });
      const outside = all.filter((c) => !c.inHead);
      if (outside.length)
        hits.push({ severity: 'warning' as const, title: 'Canonical link outside <head>', value: outside.map((c) => c.rawHref).join('\n'), view: p.view });
      return hits;
    },
  },
  {
    id: 'idx.canonical-target',
    category: 'indexability',
    view: 'raw',
    title: 'Canonical points to this page',
    why: 'A canonical pointing to another URL asks Google to index that URL instead of this one.',
    fix: 'Make the canonical self-referencing (the exact final URL of this page) unless this page really is a duplicate.',
    docs: DOCS.canonical,
    check: ({ pick, url }) => {
      const p = pick('raw');
      if (!p) return null;
      const c = canonicalOf(p.page);
      if (!c) return null;
      const hits = [];
      if (!c.href) return [{ severity: 'error', title: 'Canonical href is invalid', value: c.rawHref, view: p.view }];
      const diff = compareUrls(c.href, url);
      if (diff !== 'identical') {
        if (diff === 'different') {
          const toHome = isHomeLike(c.href) && !isHomeLike(url);
          hits.push({
            severity: toHome ? ('error' as const) : ('warning' as const),
            title: toHome ? 'Canonical points to the homepage' : 'Canonical points to another page',
            value: c.href,
            why: toHome
              ? 'Every page canonicalised to the homepage is treated as a duplicate of it and dropped from the index.'
              : undefined,
            blocksIndexing: true,
            view: p.view,
          });
        } else {
          hits.push({
            severity: 'warning' as const,
            title: `Canonical differs from the URL by ${diff}`,
            value: `canonical: ${c.rawHref}\nURL:       ${url}`,
            why: 'A canonical that differs only cosmetically (encoding, slash, case, www, protocol) still names a different URL, so Google may index the other variant and split signals.',
            fix: 'Output the canonical exactly as the URL the server answers 200 for, and use the same form in internal links and the sitemap.',
            view: p.view,
          });
        }
      }
      if (!isAbsoluteHttp(c.rawHref))
        hits.push({ severity: 'warning' as const, title: 'Canonical is not an absolute URL', value: c.rawHref, fix: 'Use an absolute https URL.', view: p.view });
      if (safeUrl(c.href)?.protocol === 'http:' && safeUrl(url)?.protocol === 'https:')
        hits.push({ severity: 'warning' as const, title: 'Canonical uses http on an https page', value: c.href, view: p.view });
      return hits;
    },
  },
  {
    id: 'idx.canonical-link-encoding',
    category: 'indexability',
    view: 'raw',
    title: 'Internal links use the canonical URL form',
    why: 'When internal links and the canonical spell the same URL differently (e.g. %3A vs :), crawlers see two URLs for one page.',
    fix: 'Generate canonical, internal links and sitemap entries from one URL builder so they encode the same way.',
    docs: DOCS.canonical,
    check: ({ pick, rendered }) => {
      const p = pick('raw');
      if (!p) return null;
      const c = canonicalOf(p.page);
      if (!c?.href) return null;
      const anchors = [...p.page.anchors, ...(rendered && rendered !== p.page ? rendered.anchors : [])];
      const variants = new Set<string>();
      for (const a of anchors) {
        if (a.kind !== 'http' || !a.href) continue;
        if (!samePage(a.href, c.href)) continue;
        const d = compareUrls(a.href, c.href);
        if (d === 'encoding' && decodeSafe(a.href) === decodeSafe(c.href)) variants.add(a.href);
      }
      if (!variants.size) return [];
      return [
        {
          severity: 'warning',
          title: 'Canonical and internal links encode the URL differently',
          value: `canonical: ${c.href}\nlinks:     ${[...variants].slice(0, 3).join('\n           ')}`,
          view: p.view,
        },
      ];
    },
  },
  {
    id: 'idx.canonical-js',
    category: 'indexability',
    view: 'rendered',
    title: 'Canonical not changed by JavaScript',
    why: 'Google says a canonical changed by JavaScript may not be honoured; social scrapers only see the raw one.',
    fix: 'Output the final canonical in the server HTML.',
    docs: 'https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics#properly-inject-rel=canonical-link-tag',
    check: ({ raw, rendered }) => {
      if (!raw || !rendered) return null;
      const a = canonicalOf(raw)?.href ?? null;
      const b = canonicalOf(rendered)?.href ?? null;
      if (a === b) return [];
      return [{ severity: a ? 'warning' : 'error', title: a ? 'Canonical changed by JavaScript' : 'Canonical only added by JavaScript', value: `raw: ${a ?? '(none)'}\nrendered: ${b ?? '(none)'}` }];
    },
  },
  {
    id: 'idx.canonical-probe',
    category: 'indexability',
    view: 'probe',
    title: 'Canonical target is 200, indexable and self-canonical',
    why: 'If the canonical target does not resolve, is noindex or points elsewhere, Google receives conflicting signals and may ignore the canonical.',
    fix: 'Point the canonical at a live, indexable URL whose own canonical is itself.',
    docs: DOCS.canonical,
    check: ({ probes }) => {
      const pr = probes.canonical;
      if (!pr) return null;
      const r = pr.result;
      const hits = [];
      if (r.error || r.status !== 200) hits.push({ severity: 'error' as const, title: `Canonical target returns ${r.error ?? r.status}`, value: pr.canonical });
      else {
        if (r.noindex) hits.push({ severity: 'error' as const, title: 'Canonical target is noindex', value: pr.canonical });
        if (r.canonical && !samePage(r.canonical, r.finalUrl))
          hits.push({ severity: 'warning' as const, title: 'Canonical target is canonicalised elsewhere', value: `${pr.canonical} → ${r.canonical}` });
        if (!samePage(r.finalUrl, pr.canonical))
          hits.push({ severity: 'warning' as const, title: 'Canonical target redirects', value: `${pr.canonical} → ${r.finalUrl}` });
      }
      return hits;
    },
  },
  {
    id: 'idx.sitemap',
    category: 'indexability',
    view: 'site',
    title: 'URL listed in the sitemap',
    why: 'Sitemaps help Google discover and recrawl pages, especially pages with few internal links.',
    fix: 'List the canonical URL (exactly as in rel=canonical) in the XML sitemap, and reference the sitemap in robots.txt.',
    docs: DOCS.sitemap,
    check: ({ site }) => {
      const s = site?.sitemap;
      if (!s) return null;
      if (!s.found) return [{ severity: 'info', title: 'No sitemap found', value: s.checked.join('\n') || 'robots.txt has no Sitemap line and /sitemap.xml is missing' }];
      if (s.listed) return [];
      if (s.listed === null) return null;
      return [
        {
          severity: 'warning',
          title: s.capped ? 'URL not found in the sitemap (sitemap partially read)' : 'URL not listed in the sitemap',
          value: `${plural(s.urlCount, 'URL')} checked in ${plural(s.checked.length, 'sitemap')}`,
        },
      ];
    },
  },
  {
    id: 'idx.soft404',
    category: 'indexability',
    view: 'probe',
    title: 'Unknown URLs return 404',
    why: 'When made-up URLs return 200 ("soft 404"), Google wastes crawl budget on them, may index empty pages and reports them as soft 404 in Search Console.',
    fix: 'Return a real 404 (or 410) status for unknown paths; with a SPA, have the server check the route exists or render a noindex 404 page.',
    docs: DOCS.soft404,
    check: ({ probes }) => {
      const p = probes.soft404;
      if (!p) return null;
      const r = p.result;
      if (r.error) return [{ severity: 'info', title: 'Soft-404 probe failed', value: r.error }];
      if (r.status === 404 || r.status === 410) return [];
      if (!samePage(r.finalUrl, p.probeUrl))
        return [
          {
            severity: 'warning',
            title: 'Unknown URLs redirect instead of returning 404',
            value: `${p.probeUrl} → ${r.finalUrl} (${r.status})`,
            why: 'Redirecting unknown URLs (often to the homepage) is treated by Google as a soft 404.',
          },
        ];
      if (r.status === 200) {
        const extra = [`title: ${r.title ?? '(none)'}`, `canonical: ${r.canonical ?? '(none)'}`, r.noindex ? 'noindex: yes (mitigates)' : 'noindex: no'];
        return [{ severity: r.noindex ? 'warning' : 'error', title: 'Soft 404: unknown URLs return 200', value: `${p.probeUrl}\n${extra.join('\n')}` }];
      }
      return [{ severity: 'info', title: `Unknown URLs return ${r.status}`, value: p.probeUrl }];
    },
  },
];

