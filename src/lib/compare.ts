// Comparison sets: metrics per URL, best-value highlighting and exports.
import { canonical, description, frameworkBytes, hreflangs, internalLinks, jsonLdTypes, kb, socialMeta, title } from './page';
import type { AuditReport, Category, PageData, RawAudit, ShareImageCheck } from './types';
import { CATEGORIES } from './rules/engine';
import { samePage } from './url';

export interface CompareSet {
  id: string;
  name: string;
  urls: string[];
  createdAt: number;
}

export interface CompareMetrics {
  url: string;
  finalUrl: string;
  status: number;
  error: string | null;
  indexable: boolean;
  indexabilityReasons: string[];
  title: string | null;
  description: string | null;
  h1: string | null;
  h1Count: number;
  canonical: string | null;
  canonicalSelf: boolean | null;
  hreflangLangs: string[];
  schemaTypes: string[];
  ogPresent: string[];
  ogMissing: string[];
  shareImage: { width: number | null; height: number | null; bytes: number; format: string; error: string | null } | null;
  rawWords: number;
  renderedWords: number | null;
  htmlBytes: number;
  frameworkBytes: number;
  inlineCssBytes: number;
  fontFaceCount: number;
  internalLinks: number;
  nonCrawlable: number | null;
  images: number;
  imagesNoAlt: number;
  scores: Record<Category, number>;
  errors: number;
  warnings: number;
}

export interface CompareRun {
  id: string;
  setId: string;
  at: number;
  results: CompareMetrics[];
}

const SHARE_TAGS = ['og:title', 'og:description', 'og:image', 'og:url', 'og:type', 'twitter:card'];

export function metricsFrom(
  url: string,
  raw: RawAudit,
  report: AuditReport,
  image: ShareImageCheck | null,
  rendered: PageData | null,
): CompareMetrics {
  const p = raw.page;
  const h1s = p ? p.headings.filter((h) => h.level === 1) : [];
  const canon = p ? canonical(p) : null;
  const present = p ? SHARE_TAGS.filter((t) => socialMeta(p, t)) : [];
  return {
    url,
    finalUrl: raw.fetch.finalUrl,
    status: raw.fetch.status,
    error: raw.fetch.error,
    indexable: report.indexable,
    indexabilityReasons: report.indexabilityReasons,
    title: p ? title(p) : null,
    description: p ? description(p) : null,
    h1: h1s[0]?.text ?? null,
    h1Count: h1s.length,
    canonical: canon,
    canonicalSelf: canon ? samePage(canon, raw.fetch.finalUrl) : null,
    hreflangLangs: p ? [...new Set(hreflangs(p).map((h) => h.lang))] : [],
    schemaTypes: p ? jsonLdTypes(p) : [],
    ogPresent: present,
    ogMissing: SHARE_TAGS.filter((t) => !present.includes(t)),
    shareImage: image ? { width: image.width, height: image.height, bytes: image.bytes, format: image.format, error: image.error ?? (image.status !== 200 ? `HTTP ${image.status}` : null) } : null,
    rawWords: p?.wordCount ?? 0,
    renderedWords: rendered?.wordCount ?? null,
    htmlBytes: raw.fetch.bytes,
    frameworkBytes: p ? frameworkBytes(p) : 0,
    inlineCssBytes: p?.inlineStyleBytes ?? 0,
    fontFaceCount: p?.fontFaceCount ?? 0,
    internalLinks: (rendered ?? p) ? internalLinks((rendered ?? p)!).length : 0,
    nonCrawlable: rendered ? rendered.clickables.length : null,
    images: (rendered ?? p)?.images.length ?? 0,
    imagesNoAlt: (rendered ?? p)?.images.filter((i) => i.alt === null && !i.decorative).length ?? 0,
    scores: report.scores,
    errors: report.findings.filter((f) => f.severity === 'error').length,
    warnings: report.findings.filter((f) => f.severity === 'warning').length,
  };
}

export interface MetricRow {
  key: string;
  label: string;
  show: (m: CompareMetrics) => string;
  /** Numeric value for "best" highlighting; null = not comparable. */
  value?: (m: CompareMetrics) => number | null;
  better?: 'high' | 'low';
}

const len = (s: string | null) => (s ? [...s].length : 0);

export const METRIC_ROWS: MetricRow[] = [
  { key: 'status', label: 'Status', show: (m) => (m.error ? `error: ${m.error}` : String(m.status)), value: (m) => (m.status === 200 ? 1 : 0), better: 'high' },
  { key: 'indexable', label: 'Indexable', show: (m) => (m.indexable ? 'yes' : `no (${m.indexabilityReasons.join('; ')})`), value: (m) => (m.indexable ? 1 : 0), better: 'high' },
  { key: 'title', label: 'Title (length)', show: (m) => (m.title ? `${m.title} (${len(m.title)})` : '—') },
  { key: 'description', label: 'Description (length)', show: (m) => (m.description ? `${m.description.slice(0, 90)}${len(m.description) > 90 ? '…' : ''} (${len(m.description)})` : '—') },
  { key: 'h1', label: 'h1', show: (m) => (m.h1Count ? `${m.h1 || '(empty)'}${m.h1Count > 1 ? ` (+${m.h1Count - 1})` : ''}` : '—') },
  { key: 'canonical', label: 'Canonical self?', show: (m) => (m.canonical ? (m.canonicalSelf ? 'yes' : `no → ${m.canonical}`) : 'missing'), value: (m) => (m.canonicalSelf ? 1 : 0), better: 'high' },
  { key: 'hreflang', label: 'hreflang languages', show: (m) => (m.hreflangLangs.length ? `${m.hreflangLangs.length}: ${m.hreflangLangs.join(' ')}` : '—'), value: (m) => m.hreflangLangs.length, better: 'high' },
  { key: 'schema', label: 'Schema types', show: (m) => m.schemaTypes.join(', ') || '—', value: (m) => m.schemaTypes.length, better: 'high' },
  { key: 'og', label: 'OG completeness', show: (m) => `${m.ogPresent.length}/${SHARE_TAGS.length}${m.ogMissing.length ? ` (missing ${m.ogMissing.join(', ')})` : ''}`, value: (m) => m.ogPresent.length, better: 'high' },
  {
    key: 'shareImage',
    label: 'Share image',
    show: (m) =>
      !m.shareImage ? '—' : m.shareImage.error ? `error: ${m.shareImage.error}` : `${m.shareImage.width ?? '?'}×${m.shareImage.height ?? '?'} ${m.shareImage.width && m.shareImage.height ? `(${(m.shareImage.width / m.shareImage.height).toFixed(2)}:1)` : ''} ${kb(m.shareImage.bytes)} ${m.shareImage.format}`,
  },
  { key: 'rawWords', label: 'Raw text words', show: (m) => String(m.rawWords), value: (m) => m.rawWords, better: 'high' },
  { key: 'ratio', label: 'Rendered / raw words', show: (m) => (m.renderedWords === null ? 'n/a (not open in a tab)' : m.rawWords ? `${(m.renderedWords / m.rawWords).toFixed(2)}× (${m.renderedWords})` : `∞ (${m.renderedWords})`), value: (m) => (m.renderedWords === null ? null : m.rawWords ? m.renderedWords / m.rawWords : 1e9), better: 'low' },
  { key: 'html', label: 'HTML size', show: (m) => kb(m.htmlBytes), value: (m) => m.htmlBytes, better: 'low' },
  { key: 'framework', label: 'Framework payload', show: (m) => kb(m.frameworkBytes), value: (m) => m.frameworkBytes, better: 'low' },
  { key: 'css', label: 'Inline CSS', show: (m) => `${kb(m.inlineCssBytes)}${m.fontFaceCount ? ` (${m.fontFaceCount} @font-face)` : ''}`, value: (m) => m.inlineCssBytes, better: 'low' },
  { key: 'internalLinks', label: 'Internal links', show: (m) => String(m.internalLinks), value: (m) => m.internalLinks, better: 'high' },
  { key: 'nonCrawlable', label: 'Non-crawlable link candidates', show: (m) => (m.nonCrawlable === null ? 'n/a (not open in a tab)' : String(m.nonCrawlable)), value: (m) => m.nonCrawlable, better: 'low' },
  { key: 'imagesNoAlt', label: 'Images without alt', show: (m) => `${m.imagesNoAlt} / ${m.images}`, value: (m) => m.imagesNoAlt, better: 'low' },
  { key: 'issues', label: 'Errors / warnings', show: (m) => `${m.errors} / ${m.warnings}`, value: (m) => m.errors * 100 + m.warnings, better: 'low' },
  ...CATEGORIES.map(
    (c): MetricRow => ({ key: `score.${c.id}`, label: `Score: ${c.label}`, show: (m) => String(m.scores[c.id]), value: (m) => m.scores[c.id], better: 'high' }),
  ),
];

/** Indexes of the best column(s) for a row, or [] when not comparable / all equal. */
export function bestColumns(row: MetricRow, results: CompareMetrics[]): number[] {
  if (!row.value || !row.better || results.length < 2) return [];
  const vals = results.map((m) => row.value!(m));
  const nums = vals.filter((v): v is number => v !== null);
  if (nums.length < 2) return [];
  const best = row.better === 'high' ? Math.max(...nums) : Math.min(...nums);
  if (nums.every((v) => v === best)) return [];
  return vals.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
}

const shortUrl = (u: string) => {
  try {
    const p = new URL(u);
    return p.hostname.replace(/^www\./, '') + decodeURIComponent(p.pathname);
  } catch {
    return u;
  }
};

const mdCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

export function toMarkdown(set: { name: string }, run: CompareRun): string {
  const cols = run.results;
  const lines = [
    `## ${set.name} — ${new Date(run.at).toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    '',
    `| Metric | ${cols.map((m) => mdCell(shortUrl(m.url))).join(' | ')} |`,
    `|---|${cols.map(() => '---').join('|')}|`,
  ];
  for (const row of METRIC_ROWS) {
    const best = new Set(bestColumns(row, cols));
    lines.push(`| ${row.label} | ${cols.map((m, i) => (best.has(i) ? `**${mdCell(row.show(m))}**` : mdCell(row.show(m)))).join(' | ')} |`);
  }
  lines.push('', '_Bold = best value in the row. Raw HTML audit (no JavaScript); rendered metrics only for URLs open in a tab._');
  return lines.join('\n');
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function toCsv(run: CompareRun): string {
  const rows = [['metric', ...run.results.map((m) => m.url)]];
  for (const row of METRIC_ROWS) rows.push([row.label, ...run.results.map((m) => row.show(m))]);
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

export function toJson(set: CompareSet, run: CompareRun): string {
  return JSON.stringify({ set: { name: set.name, urls: set.urls }, run }, null, 2);
}

export const HISTORY_LIMIT = 10;

export function pushRun(history: CompareRun[], run: CompareRun, limit = HISTORY_LIMIT): CompareRun[] {
  return [run, ...history.filter((r) => r.id !== run.id)].slice(0, limit);
}
