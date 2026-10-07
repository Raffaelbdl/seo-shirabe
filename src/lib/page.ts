// Accessors over PageData, shared by rules, share previews and the UI.
import type { FetchInfo, PageData } from './types';

const lc = (s: string | null | undefined) => (s || '').toLowerCase().trim();

export function metaByName(page: PageData, name: string, headOnly = true): string[] {
  const n = name.toLowerCase();
  return page.metas
    .filter((m) => lc(m.name) === n && (!headOnly || m.inHead))
    .map((m) => (m.content ?? '').trim());
}

export function metaByProperty(page: PageData, prop: string, headOnly = true): string[] {
  const p = prop.toLowerCase();
  return page.metas
    .filter((m) => lc(m.property) === p && (!headOnly || m.inHead))
    .map((m) => (m.content ?? '').trim());
}

/** og:* is read from property=, twitter:* from name= — each falls back to the other attribute. */
export function socialMeta(page: PageData, key: string): { value: string; attr: 'property' | 'name' } | null {
  const isTwitter = key.toLowerCase().startsWith('twitter:');
  const primary = isTwitter ? metaByName(page, key) : metaByProperty(page, key);
  const v1 = primary.find((v) => v !== '');
  if (v1 !== undefined) return { value: v1, attr: isTwitter ? 'name' : 'property' };
  const secondary = isTwitter ? metaByProperty(page, key) : metaByName(page, key);
  const v2 = secondary.find((v) => v !== '');
  if (v2 !== undefined) return { value: v2, attr: isTwitter ? 'property' : 'name' };
  return null;
}

export function title(page: PageData): string | null {
  const t = page.titles.find((x) => x.inHead) ?? page.titles[0];
  return t ? t.text : null;
}

export function description(page: PageData): string | null {
  const d = metaByName(page, 'description');
  return d.length ? d[0] : null;
}

export function linksByRel(page: PageData, rel: string, headOnly = true) {
  const r = rel.toLowerCase();
  return page.headLinks.filter((l) => l.rel.split(/\s+/).includes(r) && (!headOnly || l.inHead));
}

export function canonicals(page: PageData, headOnly = true) {
  return linksByRel(page, 'canonical', headOnly);
}

export function canonical(page: PageData): string | null {
  const c = canonicals(page);
  return c.length ? c[0].href : null;
}

export interface HreflangEntry {
  lang: string;
  href: string | null;
  rawHref: string;
}

export function hreflangs(page: PageData): HreflangEntry[] {
  return linksByRel(page, 'alternate')
    .filter((l) => l.hreflang)
    .map((l) => ({ lang: (l.hreflang || '').trim(), href: l.href, rawHref: l.rawHref }));
}

/** robots / googlebot meta directives, lower-cased. */
export function robotsDirectives(page: PageData, bots = ['robots', 'googlebot']): string[] {
  const out: string[] = [];
  for (const b of bots) {
    for (const c of metaByName(page, b)) out.push(...c.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean));
  }
  return out;
}

export function hasNoindex(directives: string[]): boolean {
  return directives.includes('noindex') || directives.includes('none');
}

export function header(fetch: FetchInfo | null | undefined, name: string): string | null {
  if (!fetch) return null;
  const n = name.toLowerCase();
  const values = fetch.headers.filter(([k]) => k.toLowerCase() === n).map(([, v]) => v);
  return values.length ? values.join(', ') : null;
}

/**
 * X-Robots-Tag directives that apply to Googlebot. Values may be prefixed by a
 * user agent ("googlebot: noindex"); unprefixed values apply to all crawlers.
 */
export function xRobotsDirectives(fetch: FetchInfo | null | undefined, agent = 'googlebot'): string[] {
  const out: string[] = [];
  if (!fetch) return out;
  for (const [k, v] of fetch.headers) {
    if (k.toLowerCase() !== 'x-robots-tag') continue;
    // multiple header lines may be merged with ", "
    const m = /^\s*([a-z0-9_-]+)\s*:\s*(.*)$/i.exec(v);
    const knownDirective = /^(noindex|nofollow|none|all|noarchive|nosnippet|max-|unavailable_after|notranslate|noimageindex|indexifembedded)/i;
    if (m && !knownDirective.test(m[1])) {
      if (m[1].toLowerCase() !== agent) continue;
      out.push(...m[2].toLowerCase().split(',').map((s) => s.trim()).filter(Boolean));
    } else {
      out.push(...v.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean));
    }
  }
  return out;
}

export function jsonLdTypes(page: PageData): string[] {
  const s = new Set<string>();
  for (const b of page.jsonLd) for (const t of b.types) s.add(t);
  return [...s];
}

export function favicons(page: PageData) {
  return page.headLinks.filter((l) => /(^|\s)(icon|shortcut icon|apple-touch-icon|apple-touch-icon-precomposed|mask-icon)(\s|$)/.test(l.rel));
}

export function frameworkBytes(page: PageData): number {
  return page.framework.reduce((n, f) => n + f.bytes, 0);
}

export function internalLinks(page: PageData) {
  return page.anchors.filter((a) => a.kind === 'http' && a.internal);
}

export function kb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${Math.round(bytes / 1024)} KB`;
}
