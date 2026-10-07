import type { PageData } from '../types';
import { pathDepth, safeUrl } from '../url';
import { plural, sample, type Rule } from './engine';

const DOCS = {
  links: 'https://developers.google.com/search/docs/crawling-indexing/links-crawlable',
  js: 'https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics',
  headings: 'https://developers.google.com/search/docs/appearance/title-link#page-titles',
  nofollow: 'https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links',
};

const LOADING_RE = /\b(loading|chargement|読み込み中|加载中|載入中|cargando|caricamento|wird geladen)\b|…$|\.\.\.$/i;

/** True when the raw HTML is an app shell: almost no text, or only a loading message. */
export function isShell(raw: PageData): boolean {
  const t = raw.text.trim();
  if (raw.wordCount <= 15) return true;
  return raw.wordCount <= 40 && LOADING_RE.test(t);
}

export const contentRules: Rule[] = [
  {
    id: 'content.h1',
    category: 'content',
    view: 'rendered',
    title: 'One non-empty h1',
    why: 'The h1 tells users and search engines what the page is about and is one of the sources Google uses for title links.',
    fix: 'Give the page a single, descriptive <h1> with the main topic (e.g. the anime title).',
    docs: DOCS.headings,
    check: ({ pick }) => {
      const p = pick('rendered');
      if (!p) return null;
      const h1 = p.page.headings.filter((h) => h.level === 1);
      if (!h1.length) return [{ severity: 'warning', title: 'No h1', view: p.view }];
      const hits = [];
      const empty = h1.filter((h) => !h.text);
      if (empty.length) hits.push({ severity: 'warning' as const, title: 'Empty h1', selector: empty[0].selector, view: p.view });
      if (h1.length > 1)
        hits.push({
          severity: 'info' as const,
          title: `${h1.length} h1 elements`,
          value: sample(h1, 5, (h) => h.text || '(empty)'),
          why: 'Several h1 are allowed, but one clear main heading is easier to understand.',
          fix: 'Keep one h1 for the main topic and use h2 for sections.',
          selector: h1[1].selector,
          view: p.view,
        });
      return hits;
    },
  },
  {
    id: 'content.heading-order',
    category: 'content',
    view: 'rendered',
    title: 'Heading levels not skipped',
    why: 'Skipped levels (h2 → h4) make the outline harder to follow for screen readers and parsers.',
    fix: 'Nest headings in order; style them with CSS instead of picking a level for its size.',
    check: ({ pick }) => {
      const p = pick('rendered');
      if (!p || !p.page.headings.length) return null;
      const skips: { from: number; to: number; text: string; selector: string }[] = [];
      let prev = 0;
      for (const h of p.page.headings) {
        if (prev && h.level > prev + 1) skips.push({ from: prev, to: h.level, text: h.text, selector: h.selector });
        prev = h.level;
      }
      if (!skips.length) return [];
      return [{ severity: 'info', title: `Heading levels skipped ${plural(skips.length, 'time')}`, value: sample(skips, 5, (s) => `h${s.from} → h${s.to}: ${s.text}`), selector: skips[0].selector, view: p.view }];
    },
  },
  {
    id: 'content.shell',
    category: 'content',
    view: 'raw',
    title: 'Raw HTML contains the content',
    why: 'Social scrapers and many crawlers (including AI crawlers) do not run JavaScript; Google renders later and with a budget. A raw HTML shell means they see an empty page.',
    fix: 'Server-render (SSR/SSG) or prerender the main content so it is in the HTML response.',
    docs: DOCS.js,
    check: ({ raw, rendered }) => {
      if (!raw) return null;
      const hits = [];
      if (isShell(raw) && (!rendered || rendered.wordCount > raw.wordCount + 50))
        hits.push({
          severity: 'error' as const,
          title: 'Raw HTML is an empty shell',
          value: `raw: ${raw.wordCount} words${raw.text ? ` ("${raw.text.slice(0, 80)}")` : ''}${rendered ? `\nrendered: ${rendered.wordCount} words` : ''}`,
        });
      else if (rendered && rendered.wordCount >= 150 && raw.wordCount < rendered.wordCount * 0.5)
        hits.push({
          severity: 'warning' as const,
          title: 'Most content depends on JavaScript',
          value: `raw: ${raw.wordCount} words · rendered: ${rendered.wordCount} words (${Math.round((raw.wordCount / rendered.wordCount) * 100)}% in raw HTML)`,
          view: 'rendered' as const,
        });
      return hits;
    },
  },
  {
    id: 'content.words',
    category: 'content',
    view: 'rendered',
    title: 'Enough text content',
    why: 'Pages with very little text give search engines little to understand and rank.',
    fix: 'Add useful, page-specific text (description, context, practical info).',
    check: ({ pick }) => {
      const p = pick('rendered');
      if (!p) return null;
      if (p.page.wordCount < 100) return [{ severity: 'info', title: 'Low word count', value: `${p.page.wordCount} words`, view: p.view }];
      return [];
    },
  },
  {
    id: 'content.non-crawlable',
    category: 'content',
    view: 'rendered',
    title: 'Navigation uses real links',
    why: 'Google only follows <a href> links. Clickable divs or buttons that navigate with JavaScript are invisible to crawlers, so the pages behind them are not discovered.',
    fix: 'Wrap each item in <a href="/the/target/url"> (keep the click handler if needed, but the href must exist).',
    docs: DOCS.links,
    check: ({ rendered }) => {
      if (!rendered) return null;
      const c = rendered.clickables;
      if (!c.length) return [];
      const groups = new Map<string, typeof c>();
      for (const x of c) groups.set(x.group, [...(groups.get(x.group) ?? []), x]);
      const sorted = [...groups].sort((a, b) => b[1].length - a[1].length);
      const repeated = sorted.filter(([, items]) => items.length >= 3);
      return [
        {
          severity: repeated.length ? 'warning' : 'info',
          title: `${plural(c.length, 'clickable element')} without a link`,
          value: sorted
            .slice(0, 5)
            .map(([g, items]) => `${items.length}× ${g} — e.g. "${items[0].text.slice(0, 60)}" (${items[0].reasons.join(', ')})`)
            .join('\n'),
          selector: (repeated[0]?.[1] ?? c)[0].selector,
        },
      ];
    },
  },
  {
    id: 'content.child-links',
    category: 'content',
    view: 'rendered',
    title: 'Listing page links to its items',
    why: 'A list page that shows items without linking to their pages gives crawlers no path to them.',
    fix: 'Give each item a crawlable <a href> to its detail page.',
    docs: DOCS.links,
    check: ({ pick, url }) => {
      const p = pick('rendered');
      if (!p) return null;
      const depth = pathDepth(url);
      const base = safeUrl(url);
      const deeper = p.page.anchors.filter((a) => {
        if (a.kind !== 'http' || !a.internal || !a.href) return false;
        const u = safeUrl(a.href);
        return !!u && !!base && pathDepth(a.href) > depth && u.pathname.startsWith(base.pathname.replace(/\/?$/, '/'));
      });
      const itemish = p.page.clickables.length >= 3 || p.page.images.length >= 20;
      if (deeper.length > 0 || !itemish) return [];
      return [
        {
          severity: 'warning',
          title: 'No links to detail pages under this section',
          value: `0 links below ${base?.pathname ?? url} · ${plural(p.page.images.length, 'image')} · ${plural(p.page.clickables.length, 'clickable non-link')}`,
          view: p.view,
        },
      ];
    },
  },
  {
    id: 'content.link-quality',
    category: 'content',
    view: 'rendered',
    title: 'Internal links are followable',
    why: 'javascript: URLs are not crawled; nofollow on internal links stops Google from passing signals to your own pages.',
    fix: 'Use real URLs in href and drop rel="nofollow" on internal links.',
    docs: DOCS.links,
    check: ({ pick }) => {
      const p = pick('rendered');
      if (!p) return null;
      const hits = [];
      const js = p.page.anchors.filter((a) => a.kind === 'js');
      const nofollow = p.page.anchors.filter((a) => a.internal && /\bnofollow\b/.test(a.rel));
      const empty = p.page.anchors.filter((a) => a.kind === 'http' && !a.text);
      if (js.length) hits.push({ severity: 'warning' as const, title: `${plural(js.length, 'link')} with javascript: URLs`, value: sample(js, 4, (a) => `${a.rawHref} "${a.text}"`), selector: js[0].selector, view: p.view });
      if (nofollow.length)
        hits.push({ severity: 'warning' as const, title: `${plural(nofollow.length, 'internal link')} with nofollow`, value: sample(nofollow, 4, (a) => a.href ?? a.rawHref), selector: nofollow[0].selector, view: p.view, docs: DOCS.nofollow });
      if (empty.length)
        hits.push({
          severity: 'info' as const,
          title: `${plural(empty.length, 'link')} without anchor text`,
          value: sample(empty, 4, (a) => a.href ?? a.rawHref),
          why: 'Anchor text tells Google what the target page is about.',
          fix: 'Add visible text, or alt text on the linked image, or aria-label.',
          selector: empty[0].selector,
          view: p.view,
        });
      return hits;
    },
  },
  {
    id: 'content.broken-links',
    category: 'content',
    view: 'probe',
    title: 'No broken links',
    why: 'Broken links waste crawl budget, leak link signals and frustrate users.',
    fix: 'Update or remove the links listed (or redirect the targets).',
    docs: DOCS.links,
    check: ({ probes }) => {
      const p = probes.links;
      if (!p) return null;
      const broken = p.checked.filter((c) => !c.skipped && !c.ok);
      if (!broken.length) return [];
      const internal = broken.filter((c) => c.status >= 400 && c.status < 500);
      return [
        {
          severity: internal.length ? 'warning' : 'info',
          title: `${plural(broken.length, 'broken link')}`,
          value: sample(broken, 10, (c) => `${c.error ?? c.status} ${c.url}`),
        },
      ];
    },
  },
];
