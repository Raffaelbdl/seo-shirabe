import { useState } from 'react';
import type { Anchor, PageData } from '../../../lib/types';
import type { TabProps } from '../props';
import { ExtLink, Findings, Muted, Section } from '../ui';

function Outline({ page, onShow }: { page: PageData; onShow: (s: string) => void }) {
  if (!page.headings.length) return <Muted>No headings.</Muted>;
  return (
    <ul className="outline">
      {page.headings.slice(0, 400).map((h, i) => (
        <li key={i} style={{ paddingLeft: `${(h.level - 1) * 14}px` }}>
          <button className="link outline-item" onClick={() => onShow(h.selector)} title="Show in page">
            <span className="tag">h{h.level}</span> {h.text || <Muted>(empty)</Muted>}
          </button>
        </li>
      ))}
    </ul>
  );
}

const LINK_FILTERS: { id: string; label: string; test: (a: Anchor) => boolean }[] = [
  { id: 'internal', label: 'Internal', test: (a) => a.kind === 'http' && a.internal },
  { id: 'external', label: 'External', test: (a) => a.kind === 'http' && !a.internal },
  { id: 'nofollow', label: 'nofollow', test: (a) => /\bnofollow\b/.test(a.rel) },
  { id: 'other', label: 'Not crawlable (js:, #, empty)', test: (a) => a.kind === 'js' || a.kind === 'hash' || a.kind === 'empty' },
];

export function Content({ state, report, onShow, tab }: TabProps) {
  const raw = state.raw?.page ?? null;
  const rendered = state.rendered?.page ?? null;
  const page = rendered ?? raw;
  const [view, setView] = useState<'rendered' | 'raw'>('rendered');
  const [linkFilter, setLinkFilter] = useState('internal');
  if (!page) return null;
  const p = view === 'raw' && raw ? raw : page;
  const canShow = !!rendered && tab?.id === state.tabId;
  const show = (s: string) => canShow && onShow(s);
  const links = p.anchors.filter(LINK_FILTERS.find((f) => f.id === linkFilter)!.test);
  const findings = report?.findings.filter((f) => f.category === 'content' || f.category === 'images') ?? [];

  return (
    <>
      <div className="row">
        <span className="small muted">View:</span>
        <button className={view === 'rendered' ? 'active' : ''} disabled={!rendered} onClick={() => setView('rendered')}>
          rendered DOM
        </button>
        <button className={view === 'raw' ? 'active' : ''} disabled={!raw} onClick={() => setView('raw')}>
          raw HTML
        </button>
      </div>

      <Section title="Words">
        <p>
          raw HTML: <b>{raw?.wordCount ?? '—'}</b> · rendered: <b>{rendered?.wordCount ?? '—'}</b>
          {raw && rendered && raw.wordCount > 0 && <Muted> · {Math.round((raw.wordCount / Math.max(rendered.wordCount, 1)) * 100)}% of the text is in the raw HTML</Muted>}
        </p>
      </Section>

      <Section title={`Headings (${p.headings.length})`}>
        <Outline page={p} onShow={show} />
      </Section>

      <Section title={`Links (${p.anchors.length}${p.truncated.anchors ? '+' : ''})`}>
        <div className="row wrap">
          {LINK_FILTERS.map((f) => (
            <button key={f.id} className={linkFilter === f.id ? 'active' : ''} onClick={() => setLinkFilter(f.id)}>
              {f.label} ({p.anchors.filter(f.test).length})
            </button>
          ))}
        </div>
        <ul className="plain linklist">
          {links.slice(0, 300).map((a, i) => (
            <li key={i} className="break small">
              <ExtLink href={a.href ?? ''}>{a.text || <Muted>(no text)</Muted>}</ExtLink> <Muted>{a.href ?? a.rawHref}</Muted>
              {a.rel && <span className="tag">{a.rel}</span>}
            </li>
          ))}
          {links.length > 300 && <li className="muted">… {links.length - 300} more</li>}
        </ul>
      </Section>

      <Section title={`Clickable elements without a link (${rendered?.clickables.length ?? '—'})`}>
        {!rendered ? (
          <Muted>Needs the rendered DOM.</Muted>
        ) : rendered.clickables.length ? (
          <ul className="plain">
            {rendered.clickables.slice(0, 100).map((c, i) => (
              <li key={i} className="small">
                <button className="link" onClick={() => show(c.selector)}>
                  {c.group}
                </button>{' '}
                “{c.text.slice(0, 80)}” <Muted>({c.reasons.join(', ')})</Muted>
              </li>
            ))}
          </ul>
        ) : (
          <Muted>None found.</Muted>
        )}
      </Section>

      <Section title={`Images (${p.images.length}${p.truncated.images ? '+' : ''})`}>
        <table className="grid small">
          <thead>
            <tr>
              <th>src</th>
              <th>alt</th>
              <th>w×h attr</th>
              {p.view === 'rendered' && <th>natural / shown</th>}
              <th>loading</th>
            </tr>
          </thead>
          <tbody>
            {p.images.slice(0, 200).map((im, i) => (
              <tr key={i} onClick={() => show(im.selector)} className={canShow ? 'clickable' : ''}>
                <td className="break">{(im.src ?? im.rawSrc).slice(0, 120)}</td>
                <td>{im.alt === null ? <span className="bad">missing</span> : im.alt === '' ? <Muted>""</Muted> : im.alt}</td>
                <td>{im.widthAttr && im.heightAttr ? `${im.widthAttr}×${im.heightAttr}` : <span className="warn">—</span>}</td>
                {p.view === 'rendered' && (
                  <td>
                    {im.natural ? `${im.natural.w}×${im.natural.h}` : '?'} / {im.displayed ? `${im.displayed.w}×${im.displayed.h}` : '?'}
                    {im.belowFold ? ' ↓' : ''}
                  </td>
                )}
                <td>{im.loading ?? (im.lazySrc ? 'data-src' : '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Findings: content & images">
        <Findings findings={findings} onShow={canShow ? onShow : undefined} />
      </Section>
    </>
  );
}
