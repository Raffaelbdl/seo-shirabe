import { useState } from 'react';
import { guessPageType } from '../../../lib/pageType';
import type { TabProps } from '../props';
import { ExtLink, Findings, Muted, Section } from '../ui';

export function Schema({ state, report, onShow }: TabProps) {
  const raw = state.raw?.page ?? null;
  const rendered = state.rendered?.page ?? null;
  const [view, setView] = useState<'raw' | 'rendered'>(raw ? 'raw' : 'rendered');
  const p = view === 'raw' ? (raw ?? rendered) : (rendered ?? raw);
  if (!p) return null;
  const url = state.raw?.fetch.finalUrl ?? state.url ?? '';
  const guess = guessPageType(url, p);
  const findings = report?.findings.filter((f) => f.category === 'schema') ?? [];

  return (
    <>
      <div className="row">
        <button className={view === 'raw' ? 'active' : ''} disabled={!raw} onClick={() => setView('raw')}>
          raw HTML ({raw?.jsonLd.length ?? 0})
        </button>
        <button className={view === 'rendered' ? 'active' : ''} disabled={!rendered} onClick={() => setView('rendered')}>
          rendered ({rendered?.jsonLd.length ?? 0})
        </button>
      </div>
      <p className="small">
        Page type guess: <b>{guess.type}</b> <Muted>({guess.reason})</Muted>
        <br />
        <ExtLink href={`https://search.google.com/test/rich-results?url=${encodeURIComponent(url)}`}>Google Rich Results Test ↗</ExtLink> ·{' '}
        <ExtLink href={`https://validator.schema.org/#url=${encodeURIComponent(url)}`}>Schema.org validator ↗</ExtLink>
      </p>

      <Section title={`JSON-LD (${p.jsonLd.length})`}>
        {p.jsonLd.length === 0 && <Muted>No JSON-LD.</Muted>}
        {p.jsonLd.map((b, i) => (
          <details key={i} className="jsonld" open={p.jsonLd.length <= 2}>
            <summary>
              {b.error ? <span className="bad">parse error</span> : b.types.join(', ') || '(no @type)'}
            </summary>
            {b.error && <p className="error-line">{b.error}</p>}
            <pre className="code">{b.error ? b.raw : JSON.stringify(b.parsed, null, 2).slice(0, 100_000)}</pre>
          </details>
        ))}
      </Section>

      {(p.microdataTypes.length > 0 || p.rdfaTypes.length > 0) && (
        <Section title="Microdata / RDFa">
          <ul className="plain small">
            {p.microdataTypes.map((t, i) => (
              <li key={`m${i}`}>
                <span className="tag">microdata</span> {t}
              </li>
            ))}
            {p.rdfaTypes.slice(0, 50).map((t, i) => (
              <li key={`r${i}`}>
                <span className="tag">RDFa</span> {t}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Findings: structured data">
        <Findings findings={findings} onShow={onShow} />
      </Section>
    </>
  );
}
