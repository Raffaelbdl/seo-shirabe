import { registrableDomain } from '../url';
import { plural, sample, type Rule } from './engine';

const DOCS = {
  alt: 'https://developers.google.com/search/docs/appearance/google-images#use-descriptive-alt-text',
  cls: 'https://web.dev/articles/optimize-cls#images-without-dimensions',
  lazy: 'https://web.dev/articles/browser-level-image-lazy-loading',
  size: 'https://web.dev/articles/serve-responsive-images',
};

export function hostCounts(hosts: (string | null)[], pageUrl: string): [string, number][] {
  let site: string | null = null;
  try {
    site = registrableDomain(new URL(pageUrl).hostname);
  } catch {
    /* ignore */
  }
  const counts = new Map<string, number>();
  for (const h of hosts) {
    if (!h || registrableDomain(h) === site) continue;
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
}

export const imageRules: Rule[] = [
  {
    id: 'img.alt',
    category: 'images',
    view: 'rendered',
    title: 'Images have alt text',
    why: 'Alt text is how search engines (and screen readers) understand images; it is used for Google Images and as anchor text for linked images.',
    fix: 'Add a short alt describing the image (e.g. the anime / location name). Use alt="" only for purely decorative images.',
    docs: DOCS.alt,
    check: ({ pick }) => {
      const p = pick('rendered');
      if (!p || !p.page.images.length) return null;
      const missing = p.page.images.filter((i) => i.alt === null && !i.decorative);
      if (!missing.length) return [];
      return [
        {
          severity: missing.length > 3 ? 'warning' : 'info',
          title: `${plural(missing.length, 'image')} without alt attribute`,
          value: sample(missing, 5, (i) => i.src ?? i.rawSrc),
          selector: missing[0].selector,
          view: p.view,
        },
      ];
    },
  },
  {
    id: 'img.dimensions',
    category: 'images',
    view: 'rendered',
    title: 'Images declare width and height',
    why: 'Without width/height the browser cannot reserve space, so the layout shifts when images load (CLS).',
    fix: 'Add width and height attributes matching the intrinsic aspect ratio (CSS can still resize).',
    docs: DOCS.cls,
    check: ({ pick }) => {
      const p = pick('rendered');
      if (!p || !p.page.images.length) return null;
      const missing = p.page.images.filter((i) => !i.widthAttr || !i.heightAttr);
      if (!missing.length) return [];
      return [{ severity: missing.length > 5 ? 'warning' : 'info', title: `${plural(missing.length, 'image')} without width/height`, value: sample(missing, 4, (i) => i.src ?? i.rawSrc), selector: missing[0].selector, view: p.view }];
    },
  },
  {
    id: 'img.oversized',
    category: 'images',
    view: 'rendered',
    title: 'Images not much larger than displayed',
    why: 'Downloading images far bigger than their display size wastes bandwidth and slows LCP.',
    fix: 'Serve resized images with srcset/sizes or an image CDN.',
    docs: DOCS.size,
    check: ({ rendered }) => {
      if (!rendered) return null;
      const dpr = 2;
      const big = rendered.images.filter(
        (i) => i.natural && i.displayed && i.displayed.w > 0 && i.natural.w > 400 && i.natural.w > i.displayed.w * dpr * 1.5,
      );
      if (!big.length) return [];
      return [{ severity: 'info', title: `${plural(big.length, 'image')} much larger than displayed`, value: sample(big, 4, (i) => `${i.natural!.w}px shown at ${i.displayed!.w}px — ${i.src}`), selector: big[0].selector }];
    },
  },
  {
    id: 'img.lazy',
    category: 'images',
    view: 'rendered',
    title: 'Offscreen images lazy-loaded, above-the-fold not',
    why: 'Lazy-loading offscreen images saves bandwidth; lazy-loading the hero image delays LCP.',
    fix: 'Add loading="lazy" to below-the-fold images; never on the main above-the-fold image.',
    docs: DOCS.lazy,
    check: ({ rendered }) => {
      if (!rendered || !rendered.images.length) return null;
      const hits = [];
      const notLazy = rendered.images.filter((i) => i.belowFold && i.loading !== 'lazy' && !i.lazySrc && (i.displayed?.w ?? 0) > 0);
      const lazyTop = rendered.images.filter((i) => i.belowFold === false && i.loading === 'lazy' && (i.displayed?.w ?? 0) >= 200);
      if (notLazy.length >= 5) hits.push({ severity: 'info' as const, title: `${plural(notLazy.length, 'below-the-fold image')} not lazy-loaded`, value: sample(notLazy, 3, (i) => i.src ?? i.rawSrc), selector: notLazy[0].selector });
      if (lazyTop.length) hits.push({ severity: 'info' as const, title: 'Large above-the-fold image is lazy-loaded', value: sample(lazyTop, 3, (i) => i.src ?? i.rawSrc), selector: lazyTop[0].selector });
      return hits;
    },
  },
  {
    id: 'img.hotlinked',
    category: 'images',
    view: 'rendered',
    title: 'Images served from your own domain',
    why: 'Images hotlinked from other sites are not attributed to you in Google Images, can disappear or be blocked at any time, and add DNS/TLS connections.',
    fix: 'Host the images (or licensed copies) on your own domain or CDN.',
    check: ({ pick, url }) => {
      const p = pick('rendered');
      if (!p || !p.page.images.length) return null;
      const counts = hostCounts(p.page.images.map((i) => i.host), url);
      const total = counts.reduce((n, [, c]) => n + c, 0);
      if (!total) return [];
      return [
        {
          severity: total >= 10 ? 'warning' : 'info',
          title: `${plural(total, 'image')} hotlinked from ${plural(counts.length, 'other domain')}`,
          value: counts.slice(0, 8).map(([h, c]) => `${c}× ${h}`).join('\n'),
          view: p.view,
        },
      ];
    },
  },
];
