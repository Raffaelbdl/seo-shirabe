import { useState } from 'react';
import { reportMarkdown } from '../../../lib/report';
import { CATEGORIES } from '../../../lib/rules';
import type { Category } from '../../../lib/types';
import type { TabProps } from '../props';
import { CopyButton, Findings, Section, Spinner } from '../ui';

export function Overview({ state, report, onShow }: TabProps) {
  const [cat, setCat] = useState<Category | 'all'>('all');
  if (!report) return state.running.raw || state.running.rendered ? <Spinner label="Auditing…" /> : null;
  const views = [state.raw?.page ? 'raw' : null, state.rendered ? 'rendered' : null, state.site ? 'site' : null].filter(Boolean) as string[];
  const top = report.findings.filter((f) => f.severity !== 'info').slice(0, 5);
  const shown = cat === 'all' ? report.findings : report.findings.filter((f) => f.category === cat);
  const counts = (c: Category) => report.findings.filter((f) => f.category === c && f.severity !== 'info').length;
  const pending = Object.entries(state.running).filter(([, v]) => v).map(([k]) => k);

  return (
    <>
      <div className={`verdict ${report.indexable ? 'verdict-ok' : 'verdict-bad'}`} data-testid="verdict">
        <strong>{report.indexable ? 'Indexable' : 'Not indexable'}</strong>
        {!state.raw && <span className="muted"> (raw HTML not fetched yet)</span>}
        {!report.indexable && (
          <ul>
            {report.indexabilityReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}
      </div>
      {pending.length > 0 && <Spinner label={`Collecting: ${pending.join(', ')}…`} />}
      {Object.entries(state.errors).filter(([, v]) => v).map(([k, v]) => (
        <p key={k} className="error-line">
          {k}: {v}
        </p>
      ))}

      <div className="scores">
        {CATEGORIES.map((c) => {
          const has = report.findings.some((f) => f.category === c.id) || report.passed.some((p) => p.category === c.id);
          if (!has) return null;
          const s = report.scores[c.id];
          return (
            <button key={c.id} className={`score ${cat === c.id ? 'active' : ''}`} onClick={() => setCat(cat === c.id ? 'all' : c.id)}>
              <span className={`score-n ${s >= 90 ? 'good' : s >= 60 ? 'mid' : 'bad'}`}>{s}</span>
              <span className="score-label">{c.label}</span>
              {counts(c.id) > 0 && <span className="score-count">{counts(c.id)}</span>}
            </button>
          );
        })}
      </div>

      <Section title="Top issues" right={<CopyButton label="Copy report" text={() => reportMarkdown(report, { views })} />}>
        <Findings findings={top} onShow={onShow} empty="No errors or warnings." />
      </Section>

      <Section
        title={cat === 'all' ? `All findings (${report.findings.length})` : `${CATEGORIES.find((c) => c.id === cat)?.label} (${shown.length})`}
        right={cat !== 'all' ? <button className="link" onClick={() => setCat('all')}>Show all</button> : undefined}
      >
        <Findings findings={shown} onShow={onShow} />
      </Section>

      <details className="section">
        <summary>Passed checks ({report.passed.length})</summary>
        <ul className="passed">
          {report.passed.filter((p) => cat === 'all' || p.category === cat).map((p) => (
            <li key={p.ruleId}>✓ {p.title}</li>
          ))}
        </ul>
      </details>
    </>
  );
}
