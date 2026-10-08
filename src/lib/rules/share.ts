import { canonical, headTagsInBody, socialMeta } from '../page';
import { textWidthPx, truncateChars } from '../pixels';
import { genericImageIssues, platformImageIssues } from '../share/images';
import { SOCIAL_PLATFORMS } from '../share/platforms';
import { resolvePreview } from '../share/resolve';
import { isAbsoluteHttp, isHomeLike, registrableDomain, samePage, hostOf } from '../url';
import type { Hit, Rule } from './engine';

const OGP = 'https://ogp.me/';
const X_DOCS = 'https://developer.x.com/en/docs/x-for-websites/cards/overview/markup';

const OG_REQUIRED: { tag: string; severity: 'error' | 'warning' | 'info'; why: string }[] = [
  { tag: 'og:title', severity: 'warning', why: 'Most platforms fall back to <title>, but og:title lets you write a title for sharing.' },
  { tag: 'og:description', severity: 'warning', why: 'Without it, platforms fall back to the meta description or show none.' },
  { tag: 'og:image', severity: 'error', why: 'Links without an image get a small, text-only card that is rarely clicked.' },
  { tag: 'og:url', severity: 'info', why: 'og:url is the canonical identity of the object; Facebook groups shares and likes by it.' },
  { tag: 'og:type', severity: 'info', why: 'og:type (website, article…) is one of the four required Open Graph properties.' },
];

export const shareRules: Rule[] = [
  {
    id: 'share.og',
    category: 'share',
    view: 'raw',
    title: 'Open Graph tags present',
    why: 'Social scrapers read Open Graph tags from the raw HTML to build link previews.',
    fix: 'Add <meta property="og:…" content="…"> tags in <head> of the server HTML.',
    docs: OGP,
    check: ({ raw }) => {
      if (!raw) return null;
      const hits: Hit[] = [];
      for (const r of OG_REQUIRED) if (!socialMeta(raw, r.tag)) hits.push({ severity: r.severity, title: `${r.tag} missing`, why: r.why });
      const img = socialMeta(raw, 'og:image');
      if (img && !isAbsoluteHttp(img.value))
        hits.push({ severity: 'warning', title: 'og:image is not an absolute URL', value: img.value, fix: 'Use an absolute https:// URL; several scrapers do not resolve relative URLs.' });
      return hits;
    },
  },
  {
    id: 'share.twitter-card',
    category: 'share',
    view: 'raw',
    title: 'twitter:card set',
    why: 'Without twitter:card, X falls back to the small "summary" card (square thumbnail) instead of a large image.',
    fix: 'Add <meta name="twitter:card" content="summary_large_image">.',
    docs: X_DOCS,
    check: ({ raw }) => {
      if (!raw) return null;
      const c = socialMeta(raw, 'twitter:card');
      if (!c) return [{ severity: 'warning', title: 'twitter:card missing' }];
      if (!['summary', 'summary_large_image', 'app', 'player'].includes(c.value)) return [{ severity: 'warning', title: 'Unknown twitter:card value', value: c.value }];
      return [];
    },
  },
  {
    id: 'share.og-url',
    category: 'share',
    view: 'raw',
    title: 'og:url matches the canonical',
    why: 'og:url and rel=canonical should name the same URL, or likes and shares are split across URLs.',
    fix: 'Output the same absolute URL in og:url and rel=canonical.',
    docs: OGP,
    check: ({ raw }) => {
      if (!raw) return null;
      const og = socialMeta(raw, 'og:url')?.value;
      const c = canonical(raw);
      if (!og || !c) return null;
      let ogAbs = og;
      try {
        ogAbs = new URL(og, raw.url).href;
      } catch {
        /* keep */
      }
      if (samePage(ogAbs, c) && ogAbs === c) return [];
      if (samePage(ogAbs, c)) return [{ severity: 'info', title: 'og:url and canonical differ in form', value: `og:url: ${og}\ncanonical: ${c}` }];
      return [{ severity: 'warning', title: 'og:url differs from the canonical', value: `og:url: ${og}\ncanonical: ${c}` }];
    },
  },
  {
    id: 'share.meta-in-body',
    category: 'share',
    view: 'raw',
    title: 'Share tags in <head>',
    why: 'Link-preview scrapers read <head>; many stop parsing at </head> or after the first kilobytes. Tags that end up at the bottom of <body> (e.g. Next.js 15.2+ streamed metadata for user agents it does not treat as bots) may be missed.',
    fix: 'Emit og:* / twitter:* in <head>. Next.js: set htmlLimitedBots: /.*/ in next.config to disable streamed metadata, or check with "Fetch as each platform\'s bot" which HTML each scraper actually receives.',
    docs: 'https://nextjs.org/docs/app/api-reference/config/next-config-js/htmlLimitedBots',
    check: ({ raw, input }) => {
      if (!raw) return null;
      const tags = headTagsInBody(raw)
        .map((t) => t.tag)
        .filter((t) => /^meta (property|name)="(og:|twitter:)/.test(t));
      if (!tags.length) return [];
      const ua = input.raw?.fetch.userAgent;
      return [
        {
          severity: 'warning',
          title: `${tags.length} share tag${tags.length > 1 ? 's' : ''} only in <body>${ua ? ` (fetched as ${ua})` : ''}`,
          value: tags.join('\n'),
        },
      ];
    },
  },
  {
    id: 'share.js-only',
    category: 'share',
    view: 'rendered',
    title: 'Share tags in the raw HTML',
    why: 'Facebook, X, Telegram, Discord, WhatsApp, LinkedIn and Slack do not run JavaScript: tags added by JS are invisible to them.',
    fix: 'Render Open Graph / Twitter tags on the server (SSR or prerender for bots).',
    docs: OGP,
    check: ({ raw, rendered }) => {
      if (!raw || !rendered) return null;
      const tags = ['og:title', 'og:description', 'og:image', 'twitter:card', 'twitter:image'];
      const only = tags.filter((t) => !socialMeta(raw, t) && socialMeta(rendered, t));
      const changed = tags.filter((t) => socialMeta(raw, t) && socialMeta(rendered, t) && socialMeta(raw, t)!.value !== socialMeta(rendered, t)!.value);
      const hits: Hit[] = [];
      if (only.length) hits.push({ severity: 'error', title: 'Share tags only exist after JavaScript', value: only.join(', ') });
      if (changed.length)
        hits.push({ severity: 'warning', title: 'Share tags changed by JavaScript', value: changed.map((t) => `${t}: ${socialMeta(raw, t)!.value} → ${socialMeta(rendered, t)!.value}`).join('\n'), why: 'Scrapers show the raw value, not the one you see in the browser.' });
      return hits;
    },
  },
  {
    id: 'share.truncation',
    category: 'share',
    view: 'raw',
    title: 'Share title/description fit the platforms',
    why: 'Long titles and descriptions are cut on cards; the important words should come first.',
    fix: 'Keep og:title under ~60 characters and og:description under ~155 characters.',
    check: ({ raw }) => {
      if (!raw) return null;
      const hits: Hit[] = [];
      for (const rule of SOCIAL_PLATFORMS) {
        const pv = resolvePreview(raw, rule);
        for (const field of ['title', 'description'] as const) {
          const v = pv[field].value;
          const max = rule.truncate[field];
          if (!v || !rule.displays[field] || !max) continue;
          if (truncateChars(v, max).truncated)
            hits.push({ severity: 'info', title: `${rule.name} truncates the ${field}`, value: `${[...v].length} chars (max ${max}) ← ${pv[field].source}` });
        }
      }
      const t = socialMeta(raw, 'og:title')?.value;
      if (t && textWidthPx(t, 16) > 520) hits.push({ severity: 'info', title: 'og:title is long for most cards', value: `${[...t].length} chars` });
      return hits;
    },
  },
  {
    id: 'share.image',
    category: 'share',
    view: 'raw',
    title: 'Share image loads and fits every platform',
    why: 'Scrapers fetch the image without cookies; if it fails, is too small, too heavy or in an unsupported format, the card has no image.',
    fix: 'Serve a 1200×630 JPEG or PNG under 600 KB, publicly reachable over https, with og:image:width/height.',
    docs: 'https://developers.facebook.com/docs/sharing/webmasters/images',
    check: ({ images, raw }) => {
      if (!images.length) return null;
      const hits: Hit[] = [];
      for (const c of images) {
        for (const i of genericImageIssues(c)) hits.push({ severity: i.severity, title: i.text, value: `${c.source}: ${c.url}` });
        const per = new Map<string, string[]>();
        for (const rule of SOCIAL_PLATFORMS) {
          const card = raw ? (socialMeta(raw, 'twitter:card')?.value ?? null) : null;
          for (const i of platformImageIssues(c, rule, card)) {
            const k = `${i.severity}|${i.text}`;
            per.set(k, [...(per.get(k) ?? []), rule.name]);
          }
        }
        for (const [k, names] of per) {
          const [severity, text] = k.split('|') as ['error' | 'warning' | 'info', string];
          hits.push({ severity, title: `${text} (${names.join(', ')})`, value: `${c.source}: ${c.url}${c.width ? ` — ${c.width}×${c.height}, ${Math.round(c.bytes / 1024)} KB, ${c.format}` : ''}` });
        }
        if (raw && c.source === 'og:image' && c.width && c.height) {
          const w = socialMeta(raw, 'og:image:width')?.value;
          const h = socialMeta(raw, 'og:image:height')?.value;
          if (!w || !h)
            hits.push({ severity: 'info', title: 'og:image:width / og:image:height missing', value: `actual ${c.width}×${c.height}`, why: 'Facebook renders the first share without waiting for the image when the size is declared.', fix: `Add og:image:width=${c.width} and og:image:height=${c.height}.` });
          else if (Number(w) !== c.width || Number(h) !== c.height)
            hits.push({ severity: 'warning', title: 'og:image:width/height do not match the image', value: `declared ${w}×${h}, actual ${c.width}×${c.height}` });
        }
      }
      return hits;
    },
  },
  {
    id: 'share.image-origin',
    category: 'share',
    view: 'site',
    title: 'Share image is page-specific and self-hosted',
    why: 'Re-using the homepage image makes every shared link look the same; hotlinked images can vanish, be rate-limited or blocked for scrapers.',
    fix: 'Generate a page-specific share image (e.g. cover + title) hosted on your own domain.',
    check: ({ raw, homepage, url }) => {
      if (!raw) return null;
      const img = socialMeta(raw, 'og:image')?.value ?? socialMeta(raw, 'twitter:image')?.value;
      if (!img) return null;
      let abs = img;
      try {
        abs = new URL(img, raw.url).href;
      } catch {
        /* keep */
      }
      const hits: Hit[] = [];
      const imgSite = registrableDomain(hostOf(abs));
      if (imgSite && imgSite !== registrableDomain(hostOf(url)))
        hits.push({ severity: 'warning', title: `Share image hotlinked from ${hostOf(abs)}`, value: abs });
      if (homepage?.ogImage && !isHomeLike(url) && homepage.ogImage === abs)
        hits.push({ severity: 'warning', title: 'Same share image as the homepage', value: abs });
      return hits;
    },
  },
];
