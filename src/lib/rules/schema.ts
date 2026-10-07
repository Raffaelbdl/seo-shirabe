import schemaRules from '../../rules/schema.json';
import { EXPECTED_SCHEMA, guessPageType } from '../pageType';
import { jsonLdTypes } from '../page';
import type { PageData } from '../types';
import { isHomeLike } from '../url';
import { sample, type Hit, type Rule } from './engine';

interface TypeRule {
  aliases: string[];
  required: string[];
  requiredOneOf?: string[][];
  recommended: string[];
  listItem?: { required: string[]; recommended: string[] };
  docs: string;
  note: string;
}
const TYPES = (schemaRules as { types: Record<string, TypeRule> }).types;

const GENERIC = new Set(['WebSite', 'Organization', 'SearchAction', 'EntryPoint', 'PropertyValueSpecification', 'ImageObject', 'WebPage', 'SiteNavigationElement', 'ReadAction']);

type Node = Record<string, unknown>;

/** Every object with an @type in the JSON-LD blocks (walks @graph and nesting). */
export function typedNodes(page: PageData): { node: Node; types: string[] }[] {
  const out: { node: Node; types: string[] }[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 12 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    const n = v as Node;
    const t = n['@type'];
    const types = typeof t === 'string' ? [t] : Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : [];
    if (types.length) out.push({ node: n, types: types.map((x) => x.replace(/^https?:\/\/schema\.org\//, '')) });
    for (const [k, child] of Object.entries(n)) if (k !== '@context') walk(child, depth + 1);
  };
  for (const b of page.jsonLd) if (!b.error) walk(b.parsed, 0);
  return out;
}

const present = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

function ruleFor(type: string): [string, TypeRule] | null {
  for (const [name, r] of Object.entries(TYPES)) if (name === type || r.aliases.includes(type)) return [name, r];
  return null;
}

/** Normalised JSON-LD for "same on every page" comparisons. */
export function jsonLdFingerprint(page: PageData): string[] {
  return page.jsonLd.map((b) => b.raw.replace(/\s+/g, '')).sort();
}

export const schemaChecks: Rule[] = [
  {
    id: 'schema.parse',
    category: 'schema',
    view: 'raw',
    title: 'JSON-LD parses',
    why: 'A JSON syntax error makes the whole block invisible to search engines.',
    fix: 'Fix the JSON (trailing commas, unescaped quotes, comments are invalid); test with the Rich Results Test.',
    docs: 'https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data',
    check: ({ pick }) => {
      const p = pick('raw');
      if (!p || !p.page.jsonLd.length) return null;
      const bad = p.page.jsonLd.filter((b) => b.error);
      return bad.map((b) => ({ severity: 'error' as const, title: 'JSON-LD parse error', value: `${b.error}\n${b.raw.trim().slice(0, 160)}`, selector: b.selector, view: p.view }));
    },
  },
  {
    id: 'schema.present',
    category: 'schema',
    view: 'raw',
    title: 'Structured data matches the page type',
    why: 'Structured data helps Google understand the page and makes it eligible for rich results (breadcrumbs, events, videos, articles…).',
    fix: 'Add JSON-LD describing what the page is about.',
    docs: 'https://developers.google.com/search/docs/appearance/structured-data/search-gallery',
    check: ({ pick, url }) => {
      const p = pick('raw');
      if (!p) return null;
      const types = jsonLdTypes(p.page);
      const all = [...types, ...p.page.microdataTypes.map((t) => t.replace(/^https?:\/\/schema\.org\//, '')), ...p.page.rdfaTypes];
      const guess = guessPageType(url, p.page);
      const hits: Hit[] = [];
      if (!all.length) {
        hits.push({ severity: guess.type === 'other' ? 'info' : 'warning', title: 'No structured data', value: `Page type guess: ${guess.type} (${guess.reason})`, view: p.view });
        return hits;
      }
      if (!isHomeLike(url) && types.length && types.every((t) => GENERIC.has(t)))
        hits.push({
          severity: 'warning',
          title: `Only site-wide structured data (${types.join(', ')})`,
          value: `Page type guess: ${guess.type} (${guess.reason})`,
          why: 'WebSite / Organization markup describes the site, not this page. Detail pages need their own types to qualify for rich results.',
          fix: `Add page-level JSON-LD${EXPECTED_SCHEMA[guess.type].length ? ` such as ${EXPECTED_SCHEMA[guess.type].slice(0, 3).join(' / ')}` : ''}, plus BreadcrumbList.`,
          view: p.view,
        });
      else if (EXPECTED_SCHEMA[guess.type].length && !EXPECTED_SCHEMA[guess.type].some((t) => all.includes(t)) && guess.type !== 'home')
        hits.push({
          severity: 'info',
          title: `No ${EXPECTED_SCHEMA[guess.type][0]} markup for a ${guess.type} page`,
          value: `Found: ${all.join(', ')}\nPage type guess: ${guess.type} (${guess.reason})`,
          view: p.view,
        });
      if (p.page.hasBreadcrumbNav && !all.includes('BreadcrumbList'))
        hits.push({ severity: 'info', title: 'Breadcrumb navigation without BreadcrumbList', fix: 'Describe the visible breadcrumb with BreadcrumbList JSON-LD.', docs: TYPES.BreadcrumbList.docs, view: p.view });
      return hits;
    },
  },
  {
    id: 'schema.properties',
    category: 'schema',
    view: 'raw',
    title: 'Rich-result properties present',
    why: 'Google only shows a rich result when its required properties are present; recommended ones improve it.',
    fix: 'Add the missing properties listed.',
    docs: 'https://developers.google.com/search/docs/appearance/structured-data/search-gallery',
    check: ({ pick }) => {
      const p = pick('raw');
      if (!p) return null;
      const nodes = typedNodes(p.page);
      if (!nodes.length) return null;
      const hits: Hit[] = [];
      const seen = new Set<string>();
      for (const { node, types } of nodes) {
        for (const t of types) {
          const r = ruleFor(t);
          if (!r) continue;
          const [name, rule] = r;
          const missing = rule.required.filter((k) => !present(node[k]));
          for (const group of rule.requiredOneOf ?? []) if (!group.some((k) => present(node[k]))) missing.push(group.join(' | '));
          if (rule.listItem && Array.isArray(node.itemListElement)) {
            node.itemListElement.forEach((li, i) => {
              if (!li || typeof li !== 'object') return;
              const last = i === (node.itemListElement as unknown[]).length - 1;
              for (const k of rule.listItem!.required) if (!present((li as Node)[k])) missing.push(`itemListElement[${i}].${k}`);
              if (name === 'BreadcrumbList' && !last && !present((li as Node).item)) missing.push(`itemListElement[${i}].item`);
            });
          }
          const recommended = rule.recommended.filter((k) => !present(node[k]));
          const key = `${t}|${missing.join()}|${recommended.join()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (missing.length)
            hits.push({ severity: 'error', title: `${t}: missing required properties`, value: sample(missing, 8, (x) => x), why: rule.note, docs: rule.docs, view: p.view });
          if (recommended.length)
            hits.push({ severity: 'info', title: `${t}: missing recommended properties`, value: recommended.join(', '), why: rule.note, docs: rule.docs, view: p.view });
          if (name === 'FAQPage')
            hits.push({ severity: 'info', title: 'FAQ rich results are limited', value: 'FAQPage', why: rule.note, fix: 'Keep the markup if useful, but do not expect FAQ rich results unless the site is a government or health authority.', docs: rule.docs, view: p.view });
        }
      }
      return hits;
    },
  },
  {
    id: 'schema.homepage',
    category: 'schema',
    view: 'site',
    title: 'Structured data specific to this page',
    why: 'JSON-LD that is identical on every page (copied from the homepage) adds nothing about the page itself.',
    fix: 'Generate page-specific JSON-LD (Article, Event, ItemList, BreadcrumbList…) next to the site-wide block.',
    check: ({ pick, homepage, url }) => {
      const p = pick('raw');
      if (!p || !homepage || isHomeLike(url) || !p.page.jsonLd.length) return null;
      const mine = jsonLdFingerprint(p.page);
      const theirs = [...homepage.jsonLd].sort();
      if (mine.length === theirs.length && mine.every((x, i) => x === theirs[i]))
        return [{ severity: 'warning', title: 'Same JSON-LD as the homepage', value: jsonLdTypes(p.page).join(', '), view: p.view }];
      return [];
    },
  },
  {
    id: 'schema.js-only',
    category: 'schema',
    view: 'rendered',
    title: 'Structured data in the raw HTML',
    why: 'Google can read JSON-LD injected by JavaScript, but other consumers (Bing, social, AI crawlers) often cannot.',
    fix: 'Output the JSON-LD in the server HTML.',
    check: ({ raw, rendered }) => {
      if (!raw || !rendered) return null;
      const rawTypes = new Set(jsonLdTypes(raw));
      const only = jsonLdTypes(rendered).filter((t) => !rawTypes.has(t));
      if (!only.length) return [];
      return [{ severity: 'info', title: 'Structured data only added by JavaScript', value: only.join(', ') }];
    },
  },
];
