import { description, descriptionInHead, linksByRel, metaByName, socialMeta, title, titleInHead } from '../page';
import type { PageData } from '../types';
import type { PlatformRule, ShareField } from './platforms';

export interface Resolved {
  value: string | null;
  /** Token the value came from, e.g. "og:title"; null when nothing matched. */
  source: string | null;
  /** False when the tag was only found in <body>; null when there is no value or no tag (host, first-img). */
  inHead: boolean | null;
}

interface TokenValue {
  value: string | null;
  inHead: boolean | null;
}

export function resolveTokenInfo(page: PageData, token: string): TokenValue {
  const none: TokenValue = { value: null, inHead: null };
  if (token === 'title') {
    const t = title(page);
    return t ? { value: t, inHead: titleInHead(page) } : none;
  }
  if (token === 'meta:description') {
    const d = description(page);
    return d ? { value: d, inHead: descriptionInHead(page) } : none;
  }
  if (token === 'meta:theme-color') {
    const h = metaByName(page, 'theme-color').find(Boolean);
    if (h) return { value: h, inHead: true };
    const b = metaByName(page, 'theme-color', false).find(Boolean);
    return b ? { value: b, inHead: false } : none;
  }
  if (token === 'link:image_src') {
    const h = linksByRel(page, 'image_src')[0]?.href;
    if (h) return { value: h, inHead: true };
    const b = linksByRel(page, 'image_src', false)[0]?.href;
    return b ? { value: b, inHead: false } : none;
  }
  if (token === 'host') {
    try {
      return { value: new URL(page.url).hostname, inHead: null };
    } catch {
      return none;
    }
  }
  if (token === 'first-img') {
    const img = page.images.find((i) => i.src && /^https?:/.test(i.src));
    return { value: img?.src ?? null, inHead: null };
  }
  if (token.startsWith('og:') || token.startsWith('twitter:')) {
    const m = socialMeta(page, token);
    return m && m.value ? { value: m.value, inHead: m.inHead } : none;
  }
  return none;
}

export function resolveToken(page: PageData, token: string): string | null {
  return resolveTokenInfo(page, token).value;
}

export function resolveField(page: PageData, rule: PlatformRule, field: ShareField): Resolved {
  for (const token of rule.fields[field] ?? []) {
    const info = resolveTokenInfo(page, token);
    let v = info.value;
    if (v && field === 'image') {
      try {
        v = new URL(v, page.url).href;
      } catch {
        continue;
      }
    }
    if (v) return { value: v, source: token, inHead: info.inHead };
  }
  return { value: null, source: null, inHead: null };
}

export interface SharePreview {
  platform: PlatformRule;
  title: Resolved;
  description: Resolved;
  image: Resolved;
  imageAlt: Resolved;
  siteName: Resolved;
  themeColor: Resolved;
  cardType: string | null;
  host: string;
}

export function resolvePreview(page: PageData, rule: PlatformRule): SharePreview {
  let host = '';
  try {
    host = new URL(page.url).hostname.replace(/^www\./, '');
  } catch {
    /* ignore */
  }
  return {
    platform: rule,
    title: resolveField(page, rule, 'title'),
    description: resolveField(page, rule, 'description'),
    image: resolveField(page, rule, 'image'),
    imageAlt: resolveField(page, rule, 'imageAlt'),
    siteName: resolveField(page, rule, 'siteName'),
    themeColor: resolveField(page, rule, 'themeColor'),
    cardType: rule.cardType ? (resolveToken(page, rule.cardType.tag) ?? null) : null,
    host,
  };
}

/** All distinct share-image URLs any platform would use, with the tag they come from. */
export function shareImageCandidates(page: PageData, rules: PlatformRule[]): { url: string; source: string }[] {
  const out = new Map<string, string>();
  for (const r of rules) {
    const img = resolveField(page, r, 'image');
    if (img.value && !out.has(img.value)) out.set(img.value, img.source ?? '');
  }
  return [...out].map(([url, source]) => ({ url, source }));
}
