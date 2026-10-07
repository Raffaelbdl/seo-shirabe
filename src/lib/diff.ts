// Raw HTML vs rendered DOM comparison: what only exists after JavaScript.
import { canonical, description, hreflangs, robotsDirectives, socialMeta, title } from './page';
import type { PageData } from './types';
import { stripHash } from './url';

export interface FieldChange {
  field: string;
  raw: string | null;
  rendered: string | null;
}

export interface ViewDiff {
  counts: { label: string; raw: number; rendered: number }[];
  changed: FieldChange[];
  headingsOnlyRendered: { level: number; text: string; selector: string }[];
  headingsOnlyRaw: { level: number; text: string }[];
  linksOnlyRendered: { href: string; text: string; selector: string }[];
  linksOnlyRaw: { href: string; text: string }[];
  textOnlyRendered: string[];
  textOnlyRaw: string[];
  jsonLdOnlyRendered: string[];
  wordRatio: number | null;
}

const key = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export function diffViews(raw: PageData, rendered: PageData): ViewDiff {
  const fields: [string, (p: PageData) => string | null][] = [
    ['title', title],
    ['meta description', description],
    ['canonical', canonical],
    ['robots', (p) => robotsDirectives(p).join(', ') || null],
    ['lang', (p) => p.lang],
    ['og:title', (p) => socialMeta(p, 'og:title')?.value ?? null],
    ['og:description', (p) => socialMeta(p, 'og:description')?.value ?? null],
    ['og:image', (p) => socialMeta(p, 'og:image')?.value ?? null],
    ['twitter:card', (p) => socialMeta(p, 'twitter:card')?.value ?? null],
    ['hreflang', (p) => hreflangs(p).map((h) => `${h.lang}=${h.href}`).sort().join(' ') || null],
  ];
  const changed: FieldChange[] = [];
  for (const [field, get] of fields) {
    const a = get(raw);
    const b = get(rendered);
    if ((a ?? '') !== (b ?? '')) changed.push({ field, raw: a, rendered: b });
  }

  const rawHeadings = new Set(raw.headings.map((h) => `${h.level}|${key(h.text)}`));
  const renHeadings = new Set(rendered.headings.map((h) => `${h.level}|${key(h.text)}`));
  const headingsOnlyRendered = rendered.headings.filter((h) => !rawHeadings.has(`${h.level}|${key(h.text)}`));
  const headingsOnlyRaw = raw.headings
    .filter((h) => !renHeadings.has(`${h.level}|${key(h.text)}`))
    .map(({ level, text }) => ({ level, text }));

  const linkKey = (h: string | null) => (h ? stripHash(h) : '');
  const rawLinks = new Set(raw.anchors.filter((a) => a.kind === 'http').map((a) => linkKey(a.href)));
  const renLinks = new Set(rendered.anchors.filter((a) => a.kind === 'http').map((a) => linkKey(a.href)));
  const seen = new Set<string>();
  const linksOnlyRendered: ViewDiff['linksOnlyRendered'] = [];
  for (const a of rendered.anchors) {
    const k = linkKey(a.href);
    if (a.kind !== 'http' || rawLinks.has(k) || seen.has(k)) continue;
    seen.add(k);
    linksOnlyRendered.push({ href: a.href ?? '', text: a.text, selector: a.selector });
  }
  const linksOnlyRaw: ViewDiff['linksOnlyRaw'] = [];
  seen.clear();
  for (const a of raw.anchors) {
    const k = linkKey(a.href);
    if (a.kind !== 'http' || renLinks.has(k) || seen.has(k)) continue;
    seen.add(k);
    linksOnlyRaw.push({ href: a.href ?? '', text: a.text });
  }

  const rawText = key(raw.text);
  const renText = key(rendered.text);
  const textOnlyRendered = rendered.textBlocks.filter((b) => b.length >= 3 && !rawText.includes(key(b)));
  const textOnlyRaw = raw.textBlocks.filter((b) => b.length >= 3 && !renText.includes(key(b)));

  const rawLd = new Set(raw.jsonLd.map((b) => b.raw.trim()));
  const jsonLdOnlyRendered = rendered.jsonLd.filter((b) => !rawLd.has(b.raw.trim())).map((b) => b.types.join(', ') || '(no @type)');

  return {
    counts: [
      { label: 'Words', raw: raw.wordCount, rendered: rendered.wordCount },
      { label: 'Headings', raw: raw.headings.length, rendered: rendered.headings.length },
      { label: 'Links (http)', raw: raw.anchors.filter((a) => a.kind === 'http').length, rendered: rendered.anchors.filter((a) => a.kind === 'http').length },
      { label: 'Images', raw: raw.images.length, rendered: rendered.images.length },
      { label: 'JSON-LD blocks', raw: raw.jsonLd.length, rendered: rendered.jsonLd.length },
      { label: 'Meta tags', raw: raw.metas.length, rendered: rendered.metas.length },
      { label: 'Elements in <body>', raw: raw.bodyElementCount, rendered: rendered.bodyElementCount },
    ],
    changed,
    headingsOnlyRendered,
    headingsOnlyRaw,
    linksOnlyRendered,
    linksOnlyRaw,
    textOnlyRendered,
    textOnlyRaw,
    jsonLdOnlyRendered,
    wordRatio: raw.wordCount > 0 ? rendered.wordCount / raw.wordCount : rendered.wordCount > 0 ? Infinity : null,
  };
}
