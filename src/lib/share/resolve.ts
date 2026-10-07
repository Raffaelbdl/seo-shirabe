import { description, linksByRel, metaByName, socialMeta, title } from '../page';
import type { PageData } from '../types';
import type { PlatformRule, ShareField } from './platforms';

export interface Resolved {
  value: string | null;
  /** Token the value came from, e.g. "og:title"; null when nothing matched. */
  source: string | null;
}

export function resolveToken(page: PageData, token: string): string | null {
  if (token === 'title') return title(page) || null;
  if (token === 'meta:description') return description(page) || null;
  if (token === 'meta:theme-color') return metaByName(page, 'theme-color').find(Boolean) ?? null;
  if (token === 'link:image_src') return linksByRel(page, 'image_src')[0]?.href ?? null;
  if (token === 'host') {
    try {
      return new URL(page.url).hostname;
    } catch {
      return null;
    }
  }
  if (token === 'first-img') {
    const img = page.images.find((i) => i.src && /^https?:/.test(i.src));
    return img?.src ?? null;
  }
  if (token.startsWith('og:') || token.startsWith('twitter:')) return socialMeta(page, token)?.value || null;
  return null;
}

export function resolveField(page: PageData, rule: PlatformRule, field: ShareField): Resolved {
  for (const token of rule.fields[field] ?? []) {
    let v = resolveToken(page, token);
    if (v && field === 'image') {
      try {
        v = new URL(v, page.url).href;
      } catch {
        continue;
      }
    }
    if (v) return { value: v, source: token };
  }
  return { value: null, source: null };
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
