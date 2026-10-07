import { canonical, hreflangs } from '../page';
import { isAbsoluteHttp, isHomeLike, samePage } from '../url';
import { sample, type Rule } from './engine';

const DOCS = 'https://developers.google.com/search/docs/specialty/international/localized-versions';

// ISO 639-1 language codes (Google accepts ISO 639-1 for hreflang).
const ISO639_1 = new Set(
  ('aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu').split(' '),
);

export function validateHreflang(code: string): string | null {
  const c = code.trim();
  if (c.toLowerCase() === 'x-default') return null;
  const parts = c.split('-');
  const lang = parts[0].toLowerCase();
  if (!ISO639_1.has(lang)) {
    if (/^[a-z]{2}$/i.test(lang) && ['uk', 'gb', 'us', 'eu', 'jp', 'cn', 'kr', 'dk', 'se'].includes(lang))
      return `"${lang}" is a country code, not a language code`;
    return `"${parts[0]}" is not an ISO 639-1 language code`;
  }
  if (c.includes('_')) return 'use "-" not "_" as separator';
  for (const p of parts.slice(1)) {
    if (/^[a-z]{4}$/i.test(p)) continue; // script (zh-Hant)
    if (!/^[a-z]{2}$/i.test(p) && !/^\d{3}$/.test(p)) return `"${p}" is not an ISO 3166-1 region code`;
    if (p.toLowerCase() === 'uk') return '"uk" is not a region code (use "gb")';
    if (p.toLowerCase() === 'eu') return '"eu" is not a country (use one hreflang per country, or the language alone)';
  }
  if (parts.length > 3) return 'too many subtags';
  return null;
}

export const hreflangRules: Rule[] = [
  {
    id: 'hl.points-elsewhere',
    category: 'hreflang',
    view: 'raw',
    title: 'hreflang alternates point to equivalent pages',
    why: 'Each hreflang must point to the same content in another language. Pointing a deep page’s alternates to a homepage tells Google the homepage is this page’s translation, so the signals are ignored (or the wrong URL is shown).',
    fix: 'For every language, output the URL of this same page in that language (and x-default to the default-language version of this page).',
    docs: DOCS,
    check: ({ pick, url }) => {
      const p = pick('raw');
      if (!p) return null;
      const list = hreflangs(p.page);
      if (!list.length) return null;
      const hits = [];
      if (!isHomeLike(url)) {
        const toHome = list.filter((h) => h.href && isHomeLike(h.href));
        if (toHome.length)
          hits.push({
            severity: 'error' as const,
            title: `${toHome.length === list.length ? `All ${toHome.length}` : `${toHome.length} of ${list.length}`} hreflang alternates point to a homepage`,
            value: sample(toHome, 8, (h) => `${h.lang} → ${h.href}`),
            view: p.view,
          });
      }
      const lang = (p.page.lang ?? '').toLowerCase();
      const sameLang = list.filter((h) => lang && h.lang.toLowerCase() === lang && h.href && !samePage(h.href, url));
      const canon = canonical(p.page);
      const sameLangReal = sameLang.filter((h) => !isHomeLike(h.href!) && !(canon && samePage(h.href, canon)));
      if (sameLangReal.length)
        hits.push({
          severity: 'warning' as const,
          title: `hreflang "${sameLangReal[0].lang}" (the page language) points to another URL`,
          value: sample(sameLangReal, 5, (h) => `${h.lang} → ${h.href}`),
          view: p.view,
        });
      return hits;
    },
  },
  {
    id: 'hl.self',
    category: 'hreflang',
    view: 'raw',
    title: 'hreflang includes a self-reference',
    why: 'Google requires each page in an hreflang set to list itself; without it the annotations can be ignored.',
    fix: 'Add <link rel="alternate" hreflang="<this page language>" href="<this exact URL>">.',
    docs: DOCS,
    check: ({ pick, url }) => {
      const p = pick('raw');
      if (!p) return null;
      const list = hreflangs(p.page);
      if (!list.length) return null;
      const canon = canonical(p.page);
      if (list.some((h) => h.href && (samePage(h.href, url) || (canon && samePage(h.href, canon))))) return [];
      return [{ severity: 'warning', title: 'No hreflang points to this page', value: `${list.length} alternates, none is ${url}`, view: p.view }];
    },
  },
  {
    id: 'hl.x-default',
    category: 'hreflang',
    view: 'raw',
    title: 'x-default declared',
    why: 'x-default tells Google which version to show to users whose language is not listed.',
    fix: 'Add hreflang="x-default" pointing to the default-language version of this page.',
    docs: DOCS,
    check: ({ pick }) => {
      const p = pick('raw');
      if (!p) return null;
      const list = hreflangs(p.page);
      if (!list.length) return null;
      if (list.some((h) => h.lang.toLowerCase() === 'x-default')) return [];
      return [{ severity: 'info', title: 'No x-default hreflang', view: p.view }];
    },
  },
  {
    id: 'hl.codes',
    category: 'hreflang',
    view: 'raw',
    title: 'hreflang codes are valid',
    why: 'Invalid language or region codes are ignored by Google.',
    fix: 'Use ISO 639-1 language codes, optionally followed by an ISO 3166-1 alpha-2 region (en, en-GB, pt-BR, zh-Hant).',
    docs: DOCS,
    check: ({ pick }) => {
      const p = pick('raw');
      if (!p) return null;
      const list = hreflangs(p.page);
      if (!list.length) return null;
      const bad = list.map((h) => ({ h, err: validateHreflang(h.lang) })).filter((x) => x.err);
      const hits = [];
      if (bad.length) hits.push({ severity: 'error' as const, title: 'Invalid hreflang codes', value: sample(bad, 6, (x) => `${x.h.lang}: ${x.err}`), view: p.view });
      const byLang = new Map<string, Set<string>>();
      for (const h of list) {
        const k = h.lang.toLowerCase();
        if (!byLang.has(k)) byLang.set(k, new Set());
        byLang.get(k)!.add(h.href ?? h.rawHref);
      }
      const dup = [...byLang].filter(([, s]) => s.size > 1);
      if (dup.length)
        hits.push({
          severity: 'error' as const,
          title: 'Same hreflang code points to several URLs',
          value: dup.map(([l, s]) => `${l}: ${[...s].join(', ')}`).join('\n'),
          view: p.view,
        });
      const relative = list.filter((h) => !isAbsoluteHttp(h.rawHref));
      if (relative.length)
        hits.push({
          severity: 'warning' as const,
          title: 'hreflang URLs are not absolute',
          value: sample(relative, 4, (h) => `${h.lang}: ${h.rawHref}`),
          fix: 'Google requires fully-qualified URLs (https://…) in hreflang.',
          view: p.view,
        });
      return hits;
    },
  },
  {
    id: 'hl.reciprocity',
    category: 'hreflang',
    view: 'probe',
    title: 'hreflang alternates are live and link back',
    why: 'hreflang only works when every alternate returns 200, is indexable and links back to this page (return links).',
    fix: 'Make sure each alternate page outputs the full, identical hreflang set including this URL.',
    docs: DOCS,
    check: ({ probes }) => {
      const p = probes.hreflang;
      if (!p) return null;
      const hits = [];
      const broken = p.alternates.filter((a) => a.result.error || a.result.status !== 200);
      const noindex = p.alternates.filter((a) => !a.result.error && a.result.noindex);
      const noBack = p.alternates.filter((a) => !a.result.error && a.result.status === 200 && !a.linksBack);
      if (broken.length) hits.push({ severity: 'error' as const, title: 'hreflang alternates not returning 200', value: sample(broken, 6, (a) => `${a.lang} → ${a.href} (${a.result.error ?? a.result.status})`) });
      if (noindex.length) hits.push({ severity: 'error' as const, title: 'hreflang alternates are noindex', value: sample(noindex, 6, (a) => `${a.lang} → ${a.href}`) });
      if (noBack.length) hits.push({ severity: 'warning' as const, title: 'hreflang alternates do not link back', value: sample(noBack, 6, (a) => `${a.lang} → ${a.href}`) });
      return hits;
    },
  },
];
