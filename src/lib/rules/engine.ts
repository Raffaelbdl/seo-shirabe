// Rule engine: rules are pure functions over the collected data, which keeps
// them unit-testable with HTML fixtures.
import type {
  AuditInput,
  AuditReport,
  Category,
  Finding,
  FindingView,
  FetchInfo,
  HomepageSummary,
  PageData,
  PageView,
  Probes,
  Severity,
  ShareImageCheck,
  SiteAudit,
} from '../types';

export interface Hit {
  severity: Severity;
  title: string;
  value?: string;
  why?: string;
  fix?: string;
  docs?: string;
  selector?: string;
  blocksIndexing?: boolean;
  view?: FindingView;
}

export interface Ctx {
  input: AuditInput;
  /** Final URL after redirects (or the tab URL when there is no raw fetch). */
  url: string;
  raw: PageData | null;
  rendered: PageData | null;
  fetch: FetchInfo | null;
  site: SiteAudit | null;
  probes: Probes;
  images: ShareImageCheck[];
  /** Homepage summary, only when the audited page is not the homepage itself. */
  homepage: HomepageSummary | null;
  pick(prefer: PageView): { page: PageData; view: PageView } | null;
}

export interface Rule {
  id: string;
  category: Category;
  /** Data the rule reads; 'raw'/'rendered' are preferences, the hit says what was used. */
  view: FindingView;
  /** Shown in the "passed" list. */
  title: string;
  why: string;
  fix: string;
  docs?: string;
  /** null = not applicable (data missing), [] = passed. */
  check(ctx: Ctx): Hit[] | null;
}

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'indexability', label: 'Indexability' },
  { id: 'meta', label: 'Meta' },
  { id: 'hreflang', label: 'hreflang' },
  { id: 'content', label: 'Content' },
  { id: 'images', label: 'Images' },
  { id: 'schema', label: 'Structured data' },
  { id: 'share', label: 'Share' },
  { id: 'performance', label: 'Performance' },
  { id: 'ai', label: 'AI & crawlers' },
];

export const PENALTY: Record<Severity, number> = { error: 20, warning: 8, info: 0 };

export function makeCtx(input: AuditInput): Ctx {
  const raw = input.raw?.page ?? null;
  const rendered = input.rendered?.page ?? null;
  const fetch = input.raw?.fetch ?? null;
  const url = fetch && !fetch.error ? fetch.finalUrl : input.url;
  const home = input.site?.homepage ?? null;
  return {
    input,
    url,
    raw,
    rendered,
    fetch,
    site: input.site ?? null,
    probes: input.probes ?? {},
    images: input.images ?? [],
    homepage: home && !home.isCurrentPage && home.status === 200 ? home : null,
    pick(prefer) {
      const order: [PageData | null, PageView][] =
        prefer === 'raw' ? [[raw, 'raw'], [rendered, 'rendered']] : [[rendered, 'rendered'], [raw, 'raw']];
      for (const [p, v] of order) if (p) return { page: p, view: v };
      return null;
    },
  };
}

export function runRules(input: AuditInput, rules: Rule[]): AuditReport {
  const ctx = makeCtx(input);
  const findings: Finding[] = [];
  const passed: AuditReport['passed'] = [];
  for (const rule of rules) {
    let hits: Hit[] | null;
    try {
      hits = rule.check(ctx);
    } catch (e) {
      hits = [
        {
          severity: 'info',
          title: `Rule ${rule.id} failed to run`,
          value: e instanceof Error ? e.message : String(e),
          why: 'Internal error while checking this rule.',
          fix: 'Report it with the page URL.',
        },
      ];
    }
    if (hits === null) continue;
    if (hits.length === 0) {
      passed.push({ ruleId: rule.id, title: rule.title, category: rule.category });
      continue;
    }
    for (const h of hits) {
      findings.push({
        ruleId: rule.id,
        category: rule.category,
        severity: h.severity,
        view: h.view ?? rule.view,
        title: h.title,
        value: h.value,
        why: h.why ?? rule.why,
        fix: h.fix ?? rule.fix,
        docs: h.docs ?? rule.docs,
        selector: h.selector,
        blocksIndexing: h.blocksIndexing,
      });
    }
  }
  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const scores = {} as Record<Category, number>;
  for (const c of CATEGORIES) {
    const penalty = findings.filter((f) => f.category === c.id).reduce((n, f) => n + PENALTY[f.severity], 0);
    scores[c.id] = Math.max(0, 100 - penalty);
  }
  const blocking = findings.filter((f) => f.blocksIndexing);
  return {
    url: ctx.url,
    findings,
    passed,
    scores,
    indexable: blocking.length === 0,
    indexabilityReasons: blocking.map((f) => (f.value ? `${f.title}: ${f.value}` : f.title)),
  };
}

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export function sample<T>(items: T[], n: number, fmt: (t: T) => string): string {
  const shown = items.slice(0, n).map(fmt).join('\n');
  return items.length > n ? `${shown}\n… and ${items.length - n} more` : shown;
}
