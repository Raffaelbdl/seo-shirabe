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

export interface SocialMetaHit {
  value: string;
  attr: 'property' | 'name';
  /** False when the tag was only found in <body> (e.g. Next.js streamed metadata). */
  inHead: boolean;
}

/**
 * og:* is read from property=, twitter:* from name= — each falls back to the other attribute.
 * <head> wins; tags that only exist in <body> are still returned (inHead: false) so callers can
 * show them and flag the placement instead of reporting them as missing.
 */
export function socialMeta(page: PageData, key: string): SocialMetaHit | null {
  const isTwitter = key.toLowerCase().startsWith('twitter:');
  for (const headOnly of [true, false]) {
    const primary = isTwitter ? metaByName(page, key, headOnly) : metaByProperty(page, key, headOnly);
    const v1 = primary.find((v) => v !== '');
    if (v1 !== undefined) return { value: v1, attr: isTwitter ? 'name' : 'property', inHead: headOnly };
    const secondary = isTwitter ? metaByProperty(page, key, headOnly) : metaByName(page, key, headOnly);
    const v2 = secondary.find((v) => v !== '');
    if (v2 !== undefined) return { value: v2, attr: isTwitter ? 'property' : 'name', inHead: headOnly };
  }
  return null;
}

export function title(page: PageData): string | null {
  const t = page.titles.find((x) => x.inHead) ?? page.titles[0];
  return t ? t.text : null;
}

/** Meta description: <head> first, then <body> (see descriptionInHead). */
export function description(page: PageData): string | null {
  const d = metaByName(page, 'description');
  if (d.length) return d[0];
  const b = metaByName(page, 'description', false);
  return b.length ? b[0] : null;
}

export function descriptionInHead(page: PageData): boolean {
  return metaByName(page, 'description').length > 0;
}

export function titleInHead(page: PageData): boolean {
  return page.titles.some((t) => t.inHead);
}

const HEAD_LINK_RELS = ['canonical', 'alternate', 'icon', 'shortcut', 'apple-touch-icon', 'manifest', 'image_src'];
const INDEXING_TAGS = /^(link rel="canonical"|link rel="alternate"|meta name="(robots|googlebot)")/;

/**
 * Tags that belong in <head> but were parsed into <body>. Happens when a framework streams
 * metadata after the first byte (Next.js 15.2+ "streaming metadata") or when an element the
 * parser does not allow in <head> appears before them, which closes <head> early.
 * Microdata (<meta itemprop>) is legitimately in <body> and is ignored.
 */
export function headTagsInBody(page: PageData): { tag: string; indexing: boolean }[] {
  const out: string[] = [];
  if (!page.titles.some((t) => t.inHead) && page.titles.length) out.push('title');
  for (const m of page.metas) {
    if (m.inHead || m.itemprop) continue;
    if (m.name) out.push(`meta name="${m.name.toLowerCase()}"`);
    else if (m.property) out.push(`meta property="${m.property.toLowerCase()}"`);
    else if (m.httpEquiv) out.push(`meta http-equiv="${m.httpEquiv.toLowerCase()}"`);
  }
  for (const l of page.headLinks) {
    if (l.inHead) continue;
    const rel = l.rel.split(/\s+/).find((r) => HEAD_LINK_RELS.includes(r));
    if (rel) out.push(`link rel="${l.rel}"${l.hreflang ? ` hreflang="${l.hreflang}"` : ''}`);
  }
  return [...new Set(out)].map((tag) => ({ tag, indexing: INDEXING_TAGS.test(tag) }));
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
