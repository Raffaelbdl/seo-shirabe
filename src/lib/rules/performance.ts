import { kb } from '../page';
import { AI_BOTS } from '../robots';
import type { FrameworkKind } from '../types';
import type { Hit, Rule } from './engine';
import { hostCounts } from './images';

export const FRAMEWORK_LABEL: Record<FrameworkKind, string> = {
  'angular-ng-state': 'Angular TransferState (ng-state)',
  'next-data': 'Next.js __NEXT_DATA__',
  'next-rsc': 'Next.js RSC payload (self.__next_f)',
  nuxt: 'Nuxt payload (__NUXT__)',
  remix: 'Remix context',
  sveltekit: 'SvelteKit fetched data',
  apollo: 'Apollo state',
  'redux-initial-state': 'Redux initial state',
};

export const THRESHOLDS = {
  htmlBytes: 150 * 1024,
  frameworkBytes: 50 * 1024,
  inlineCssBytes: 50 * 1024,
  fontFaces: 20,
  // Core Web Vitals "good" / "poor" boundaries (web.dev/articles/vitals).
  LCP: [2500, 4000],
  CLS: [0.1, 0.25],
  INP: [200, 500],
  TTFB: [800, 1800],
} as const;

export const performanceRules: Rule[] = [
  {
    id: 'perf.html-size',
    category: 'performance',
    view: 'raw',
    title: 'HTML weight under 150 KB',
    why: 'Heavy HTML delays first render and is parsed on every page view; Googlebot only indexes the first 2 MB of an HTML file.',
    fix: 'Move inline data, CSS and SVG out of the HTML; paginate long lists.',
    docs: 'https://developers.google.com/search/docs/crawling-indexing/googlebot#how-googlebot-accesses-your-site',
    check: ({ fetch, raw }) => {
      if (!fetch || fetch.error || !raw) return null;
      if (fetch.bytes <= THRESHOLDS.htmlBytes) return [];
      return [{ severity: fetch.bytes > 2 * 1024 * 1024 ? 'error' : 'warning', title: `HTML is ${kb(fetch.bytes)}`, value: `${kb(fetch.bytes)} (decompressed) — inline scripts ${kb(raw.inlineScriptBytes)}, inline CSS ${kb(raw.inlineStyleBytes)}${fetch.truncated ? ' — truncated by the size cap' : ''}` }];
    },
  },
  {
    id: 'perf.framework',
    category: 'performance',
    view: 'raw',
    title: 'Framework payload under 50 KB',
    why: 'Hydration payloads (TransferState, __NEXT_DATA__, RSC) duplicate the page data inside the HTML and must be downloaded and parsed before the page is interactive.',
    fix: 'Only transfer what the page needs; strip unused fields, paginate, or fetch secondary data after load.',
    check: ({ raw }) => {
      if (!raw) return null;
      const big = raw.framework.filter((f) => f.bytes > THRESHOLDS.frameworkBytes);
      return big.map((f) => ({ severity: 'warning' as const, title: `${FRAMEWORK_LABEL[f.kind]} is ${kb(f.bytes)}`, value: `${kb(f.bytes)} of inline data` }));
    },
  },
  {
    id: 'perf.inline-css',
    category: 'performance',
    view: 'raw',
    title: 'Inline CSS and fonts are lean',
    why: 'Large inline CSS (often whole font catalogues inlined as @font-face) is re-downloaded with every page and blocks rendering.',
    fix: 'Inline only critical CSS; load fonts from a cached stylesheet and subset them (unicode-range).',
    docs: 'https://web.dev/articles/extract-critical-css',
    check: ({ raw }) => {
      if (!raw) return null;
      const hits: Hit[] = [];
      if (raw.inlineStyleBytes > THRESHOLDS.inlineCssBytes)
        hits.push({ severity: 'warning', title: `Inline CSS is ${kb(raw.inlineStyleBytes)}`, value: `${raw.inlineStyleCount} <style> elements` });
      if (raw.fontFaceCount > THRESHOLDS.fontFaces)
        hits.push({ severity: 'warning', title: `${raw.fontFaceCount} inline @font-face rules`, value: `in ${raw.inlineStyleCount} <style> elements (${kb(raw.inlineStyleBytes)})` });
      if (raw.dataUriBytes > 100 * 1024)
        hits.push({ severity: 'info', title: `${raw.dataUriCount} data: URIs (${kb(raw.dataUriBytes)})`, fix: 'Serve large images and fonts as separate cacheable files.' });
      return hits;
    },
  },
  {
    id: 'perf.vitals',
    category: 'performance',
    view: 'rendered',
    title: 'Web Vitals within "good" thresholds',
    why: 'Core Web Vitals are part of Google’s page experience signals and correlate with user drop-off. Values here are a single lab-ish sample from your browser, not field data.',
    fix: 'LCP: optimise the hero image and server response. CLS: reserve space for images/ads. INP: break up long JavaScript tasks.',
    docs: 'https://web.dev/articles/vitals',
    check: ({ input }) => {
      const v = input.rendered?.vitals;
      if (!v) return null;
      const hits: Hit[] = [];
      for (const k of ['LCP', 'CLS', 'INP', 'TTFB'] as const) {
        const val = v[k];
        if (val === undefined) continue;
        const [good, poor] = THRESHOLDS[k];
        if (val <= good) continue;
        const fmt = k === 'CLS' ? val.toFixed(3) : `${Math.round(val)} ms`;
        hits.push({ severity: val > poor ? 'warning' : 'info', title: `${k} ${val > poor ? 'poor' : 'needs improvement'}: ${fmt}`, value: `good ≤ ${k === 'CLS' ? good : good + ' ms'}` });
      }
      return hits;
    },
  },
  {
    id: 'perf.image-hosts',
    category: 'performance',
    view: 'rendered',
    title: 'Few third-party image hosts',
    why: 'Each extra host costs a DNS lookup and TLS handshake before its images can load.',
    fix: 'Serve images from your own domain/CDN; preconnect to the one or two hosts you must keep.',
    check: ({ pick, url }) => {
      const p = pick('rendered');
      if (!p) return null;
      const hosts = hostCounts(p.page.images.map((i) => i.host), url);
      if (hosts.length <= 3) return [];
      return [{ severity: 'info', title: `Images from ${hosts.length} third-party hosts`, value: hosts.slice(0, 8).map(([h, c]) => `${c}× ${h}`).join('\n'), view: p.view }];
    },
  },
];

export const aiRules: Rule[] = [
  {
    id: 'ai.robots',
    category: 'ai',
    view: 'site',
    title: 'AI crawler access (robots.txt)',
    why: 'robots.txt decides whether AI crawlers may fetch the page for training (GPTBot, CCBot, Google-Extended…) or for AI search answers (OAI-SearchBot, Claude-SearchBot, PerplexityBot).',
    fix: 'Allow or disallow each crawler deliberately, per your policy.',
    docs: 'https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers#google-extended',
    check: ({ site }) => {
      const r = site?.robots;
      if (!r) return null;
      const ai = r.agents.filter((a) => AI_BOTS.includes(a.agent));
      const blocked = ai.filter((a) => !a.allowed);
      return [
        {
          severity: 'info',
          title: blocked.length ? `${blocked.length} of ${ai.length} AI crawlers blocked` : `All ${ai.length} AI crawlers allowed`,
          value: ai.map((a) => `${a.allowed ? '✓' : '✗'} ${a.agent}${a.rule ? ` (${a.rule})` : ''}`).join('\n'),
        },
      ];
    },
  },
  {
    id: 'ai.llms',
    category: 'ai',
    view: 'site',
    title: 'llms.txt',
    why: 'llms.txt is a proposed (not standardised) file pointing language models to the important content. No major search engine uses it.',
    fix: 'Optional. Add /llms.txt only if you want to.',
    docs: 'https://llmstxt.org/',
    check: ({ site }) => {
      const l = site?.llms;
      if (!l) return null;
      return [{ severity: 'info', title: l.present ? 'llms.txt present' : 'No llms.txt', value: l.present ? `${l.url} (${Math.round(l.bytes / 1024)} KB)` : l.url }];
    },
  },
];
