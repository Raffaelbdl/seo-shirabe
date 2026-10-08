import { description, favicons, headTagsInBody, hreflangs, metaByName, title } from '../page';
import { GOOGLE_DESCRIPTION_FONT_PX, GOOGLE_TITLE_FONT_PX, textWidthPx } from '../pixels';
import { platform } from '../share/platforms';
import { isHomeLike, samePage } from '../url';
import type { Rule } from './engine';

const google = platform('google');
const TITLE_PX = google.truncate.titlePx ?? 600;
const DESC_PX = google.truncate.descriptionPx ?? 920;

const DOCS = {
  title: 'https://developers.google.com/search/docs/appearance/title-link',
  snippet: 'https://developers.google.com/search/docs/appearance/snippet',
  lang: 'https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites',
  viewport: 'https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing',
  favicon: 'https://developers.google.com/search/docs/appearance/favicon-in-search',
};

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export const metaRules: Rule[] = [
  {
    id: 'meta.head-in-body',
    category: 'meta',
    view: 'raw',
    title: 'Head tags are in <head>',
    why: 'In the raw HTML, title, meta and link tags that end up in <body> are invisible to anything that does not run JavaScript, and Google ignores rel=canonical and hreflang outside <head>. Typical cause: Next.js 15.2+ streams metadata into <body> for user agents it does not list as bots, or an element not allowed in <head> closes it early.',
    fix: 'Render metadata in <head> of the server HTML. Next.js: set htmlLimitedBots: /.*/ in next.config (blocking metadata for every user agent); otherwise move the element that closes <head> early.',
    docs: 'https://nextjs.org/docs/app/api-reference/functions/generate-metadata#streaming-metadata',
    check: ({ raw, input }) => {
      if (!raw) return null;
      const tags = headTagsInBody(raw);
      if (!tags.length) return [];
      const indexing = tags.filter((t) => t.indexing).map((t) => t.tag);
      const other = tags.filter((t) => !t.indexing).map((t) => t.tag);
      const ua = input.raw?.fetch.userAgent;
      const suffix = ua ? ` (fetched as ${ua})` : '';
      const hits = [];
      if (indexing.length)
        hits.push({ severity: 'error' as const, title: `Canonical / hreflang / robots in <body>${suffix}`, value: indexing.join('\n'), why: 'Google only honours rel=canonical and hreflang in <head>; a robots meta in <body> is only seen after rendering.' });
      if (other.length) hits.push({ severity: 'warning' as const, title: `${other.length} head tag${other.length > 1 ? 's' : ''} in <body>${suffix}`, value: other.join('\n') });
      return hits;
    },
  },
  {
    id: 'meta.title',
    category: 'meta',
    view: 'raw',
    title: 'Title present and unique',
    why: 'The <title> is the main source of the title link in Google and the fallback title for share cards.',
    fix: 'Add exactly one descriptive <title> in <head>, specific to this page.',
    docs: DOCS.title,
    check: ({ pick }) => {
      const p = pick('raw');
      if (!p) return null;
      const inHead = p.page.titles.filter((t) => t.inHead);
      // A title that only exists in <body> is reported by meta.head-in-body.
      if (!inHead.length && p.page.titles.some((t) => t.text)) return [];
      if (!inHead.length || !inHead[0].text) return [{ severity: 'error', title: 'Title missing or empty', view: p.view }];
      if (inHead.length > 1)
        return [{ severity: 'warning', title: `${inHead.length} <title> elements`, value: inHead.map((t) => t.text).join('\n'), fix: 'Keep one <title>; browsers and crawlers use the first.', view: p.view }];
      return [];
    },
  },
  {
    id: 'meta.title-length',
    category: 'meta',
    view: 'raw',
    title: 'Title length fits Google results',
    why: `Google truncates title links to the available width (≈${TITLE_PX}px on desktop, an estimate). Very short titles are often rewritten.`,
    fix: 'Put the distinctive words first and keep the title under roughly 55–60 characters.',
    docs: DOCS.title,
    check: ({ pick }) => {
      const p = pick('raw');
      const t = p ? title(p.page) : null;
      if (!p || !t) return null;
      const px = textWidthPx(t, GOOGLE_TITLE_FONT_PX);
      const chars = [...t].length;
      if (px > TITLE_PX) return [{ severity: 'warning', title: 'Title likely truncated in Google', value: `${chars} chars ≈ ${px}px (limit ≈ ${TITLE_PX}px)\n${t}`, view: p.view }];
      if (chars < 15) return [{ severity: 'info', title: 'Title is very short', value: `${chars} chars: ${t}`, view: p.view }];
      return [];
    },
  },
  {
    id: 'meta.title-homepage',
    category: 'meta',
    view: 'site',
    title: 'Title differs from the homepage',
    why: 'Pages that reuse the homepage title look like duplicates and get poor title links.',
    fix: 'Generate a page-specific title (e.g. "<Anime> pilgrimage map – <Site>").',
    docs: DOCS.title,
    check: ({ pick, homepage, url }) => {
      const p = pick('raw');
      if (!p || !homepage || isHomeLike(url)) return null;
      const t = title(p.page);
      if (t && homepage.title && norm(t) === norm(homepage.title))
        return [{ severity: 'warning', title: 'Same title as the homepage', value: t, view: p.view }];
      return [];
    },
  },
  {
    id: 'meta.description',
    category: 'meta',
    view: 'raw',
    title: 'Meta description present',
    why: 'Google often uses the meta description for the snippet, and share cards use it as a fallback description.',
    fix: 'Add one <meta name="description" content="…"> that summarises this specific page (≈ 120–155 characters).',
    docs: DOCS.snippet,
    check: ({ pick }) => {
      const p = pick('raw');
      if (!p) return null;
      const d = metaByName(p.page, 'description');
      const hits = [];
      if (!d.length || !d[0]) hits.push({ severity: 'warning' as const, title: 'Meta description missing', view: p.view });
      if (d.length > 1)
        hits.push({ severity: 'warning' as const, title: `${d.length} meta descriptions`, value: d.join('\n'), fix: 'Keep a single meta description.', view: p.view });
      return hits;
    },
  },
  {
    id: 'meta.description-length',
    category: 'meta',
    view: 'raw',
    title: 'Meta description length',
    why: `Snippets are cut to the available width (≈${DESC_PX}px desktop, estimate); too short descriptions are usually replaced by page text.`,
    fix: 'Aim for about 120–155 characters with the key information first.',
    docs: DOCS.snippet,
    check: ({ pick }) => {
      const p = pick('raw');
      const d = p ? description(p.page) : null;
      if (!p || !d) return null;
      const px = textWidthPx(d, GOOGLE_DESCRIPTION_FONT_PX);
      const chars = [...d].length;
      if (px > DESC_PX) return [{ severity: 'info', title: 'Description likely truncated in Google', value: `${chars} chars ≈ ${px}px (limit ≈ ${DESC_PX}px)`, view: p.view }];
      if (chars < 50) return [{ severity: 'info', title: 'Description is short', value: `${chars} chars: ${d}`, view: p.view }];
      return [];
    },
  },
  {
    id: 'meta.description-homepage',
    category: 'meta',
    view: 'site',
    title: 'Description differs from the homepage',
    why: 'A description copied from the homepage says nothing about this page: Google ignores it and share cards look identical for every page.',
    fix: 'Generate the description from this page’s own content.',
    docs: DOCS.snippet,
    check: ({ pick, homepage, url }) => {
      const p = pick('raw');
      if (!p || !homepage || isHomeLike(url)) return null;
      const d = description(p.page);
      if (d && homepage.description && norm(d) === norm(homepage.description))
        return [{ severity: 'warning', title: 'Description identical to the homepage', value: d, view: p.view }];
      return [];
    },
  },
  {
    id: 'meta.js-changed',
    category: 'meta',
    view: 'rendered',
    title: 'Title and description not changed by JavaScript',
    why: 'Social scrapers never run JavaScript: they show the raw values. Google renders, but uses the raw HTML first.',
    fix: 'Render the final title and description on the server (SSR / prerender).',
    check: ({ raw, rendered }) => {
      if (!raw || !rendered) return null;
      const hits = [];
      const pairs: [string, string | null, string | null][] = [
        ['Title', title(raw), title(rendered)],
        ['Description', description(raw), description(rendered)],
      ];
      for (const [label, a, b] of pairs) {
        if (norm(a) === norm(b)) continue;
        hits.push({
          severity: a ? ('info' as const) : ('warning' as const),
          title: a ? `${label} changed by JavaScript` : `${label} only exists after JavaScript`,
          value: `raw: ${a ?? '(none)'}\nrendered: ${b ?? '(none)'}`,
        });
      }
      return hits;
    },
  },
  {
    id: 'meta.lang',
    category: 'meta',
    view: 'raw',
    title: '<html lang> set and consistent with hreflang',
    why: 'lang helps browsers, screen readers and translation; a lang that contradicts hreflang is a mixed signal.',
    fix: 'Set <html lang="xx"> to the page language, matching its own hreflang entry.',
    docs: DOCS.lang,
    check: ({ pick, url }) => {
      const p = pick('raw');
      if (!p) return null;
      const lang = (p.page.lang ?? '').trim();
      if (!lang) return [{ severity: 'warning', title: '<html lang> missing', view: p.view }];
      const self = hreflangs(p.page).find((h) => h.lang.toLowerCase() !== 'x-default' && h.href && samePage(h.href, url));
      if (self && self.lang.split('-')[0].toLowerCase() !== lang.split(/[-_]/)[0].toLowerCase())
        return [{ severity: 'warning', title: 'lang does not match the page’s own hreflang', value: `lang="${lang}" · hreflang="${self.lang}"`, view: p.view }];
      return [];
    },
  },
  {
    id: 'meta.viewport',
    category: 'meta',
    view: 'raw',
    title: 'Viewport meta present',
    why: 'Google indexes the mobile version; without a viewport the page renders as a zoomed-out desktop page on phones.',
    fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
    docs: DOCS.viewport,
    check: ({ pick }) => {
      const p = pick('raw');
      if (!p) return null;
      const v = metaByName(p.page, 'viewport', false);
      if (!v.length) return [{ severity: 'warning', title: 'Viewport meta missing', view: p.view }];
      if (/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(v[0]))
        return [{ severity: 'info', title: 'Viewport disables zoom', value: v[0], fix: 'Allow pinch-zoom (accessibility).', view: p.view }];
      return [];
    },
  },
  {
    id: 'meta.charset',
    category: 'meta',
    view: 'raw',
    title: 'Charset declared',
    why: 'Without a declared charset, browsers and scrapers may garble accents and CJK characters in titles and previews.',
    fix: 'Put <meta charset="utf-8"> first in <head> (or send charset in Content-Type).',
    check: ({ pick, fetch }) => {
      const p = pick('raw');
      if (!p) return null;
      if (p.page.charset || /charset=/i.test(fetch?.contentType ?? '')) return [];
      return [{ severity: 'info', title: 'No charset declared', view: p.view }];
    },
  },
  {
    id: 'meta.favicon',
    category: 'meta',
    view: 'raw',
    title: 'Favicon declared',
    why: 'Google shows the favicon next to results; it must be declared with <link rel="icon"> on the homepage.',
    fix: 'Add <link rel="icon" href="/favicon.png"> (square, larger than 48×48) and an apple-touch-icon.',
    docs: DOCS.favicon,
    check: ({ pick }) => {
      const p = pick('raw');
      if (!p) return null;
      if (favicons(p.page).length) return [];
      return [{ severity: 'info', title: 'No favicon link', value: 'Browsers fall back to /favicon.ico', view: p.view }];
    },
  },
];
