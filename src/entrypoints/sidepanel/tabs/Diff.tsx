import { useMemo } from 'react';
import { diffViews } from '../../../lib/diff';
import type { TabProps } from '../props';
import { ExtLink, Muted, Section } from '../ui';

export function Diff({ state, onShow, tab }: TabProps) {
  const raw = state.raw?.page ?? null;
  const rendered = state.rendered?.page ?? null;
  const d = useMemo(() => (raw && rendered ? diffViews(raw, rendered) : null), [raw, rendered]);
  if (!d) return <Muted>Needs both the raw HTML and the rendered DOM.</Muted>;
  const canShow = tab?.id === state.tabId;

  return (
    <>
      <Section title="Counts">
        <table className="grid">
          <thead>
            <tr>
              <th></th>
              <th>raw HTML</th>
              <th>rendered</th>
            </tr>
          </thead>
          <tbody>
            {d.counts.map((c) => (
              <tr key={c.label} className={c.raw !== c.rendered ? 'diff-row' : ''}>
                <th>{c.label}</th>
                <td>{c.raw}</td>
                <td>{c.rendered}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {d.wordRatio !== null && Number.isFinite(d.wordRatio) && <p className="small muted">Rendered text is {d.wordRatio.toFixed(2)}× the raw text.</p>}
      </Section>

      <Section title={`Head values changed by JavaScript (${d.changed.length})`}>
        {d.changed.length === 0 ? (
          <p className="ok">✓ Same head values in both views.</p>
        ) : (
          <table className="grid small">
            <tbody>
              {d.changed.map((c) => (
                <tr key={c.field}>
                  <th>{c.field}</th>
                  <td className="break">
                    <span className="tag tag-raw">raw</span> {c.raw ?? <Muted>(none)</Muted>}
                    <br />
                    <span className="tag tag-rendered">rendered</span> {c.rendered ?? <Muted>(none)</Muted>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={`Headings only after JS (${d.headingsOnlyRendered.length})`}>
        <ul className="plain small">
          {d.headingsOnlyRendered.slice(0, 100).map((h, i) => (
            <li key={i}>
              <button className="link" onClick={() => canShow && onShow(h.selector)}>
                <span className="tag">h{h.level}</span> {h.text || '(empty)'}
              </button>
            </li>
          ))}
        </ul>
        {d.headingsOnlyRaw.length > 0 && <p className="small muted">{d.headingsOnlyRaw.length} headings exist in the raw HTML but not after rendering.</p>}
      </Section>

      <Section title={`Links only after JS (${d.linksOnlyRendered.length})`}>
        <ul className="plain small">
          {d.linksOnlyRendered.slice(0, 150).map((l, i) => (
            <li key={i} className="break">
              <ExtLink href={l.href}>{l.text || l.href}</ExtLink> <Muted>{l.href}</Muted>
            </li>
          ))}
        </ul>
        {d.linksOnlyRaw.length > 0 && <p className="small muted">{d.linksOnlyRaw.length} links exist in the raw HTML but not after rendering.</p>}
      </Section>

      <Section title={`Text only after JS (${d.textOnlyRendered.length} blocks)`}>
        <ul className="plain small textblocks">
          {d.textOnlyRendered.slice(0, 150).map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </Section>

      {d.jsonLdOnlyRendered.length > 0 && (
        <Section title="JSON-LD only after JS">
          <p>{d.jsonLdOnlyRendered.join(' · ')}</p>
        </Section>
      )}
    </>
  );
}
