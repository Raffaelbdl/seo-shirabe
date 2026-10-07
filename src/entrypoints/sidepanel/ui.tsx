// Shared UI pieces. All page-derived values are rendered as React text
// (escaped); nothing from a page is ever injected as HTML.
import { useState, type ReactNode } from 'react';
import type { Finding, FindingView, Severity } from '../../lib/types';

export function SevIcon({ s }: { s: Severity }) {
  const label = s === 'error' ? 'Error' : s === 'warning' ? 'Warning' : 'Info';
  return (
    <span className={`sev sev-${s}`} role="img" aria-label={label} title={label}>
      {s === 'error' ? '✕' : s === 'warning' ? '!' : 'i'}
    </span>
  );
}

export function ViewTag({ v }: { v: FindingView }) {
  const label = { raw: 'raw HTML', rendered: 'rendered DOM', site: 'site files', probe: 'probe' }[v];
  return <span className={`tag tag-${v}`}>{label}</span>;
}

export function FindingRow({ f, onShow }: { f: Finding; onShow?: (selector: string) => void }) {
  const [open, setOpen] = useState(f.severity === 'error');
  return (
    <li className={`finding finding-${f.severity}`}>
      <button className="finding-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <SevIcon s={f.severity} />
        <span className="finding-title">{f.title}</span>
        <ViewTag v={f.view} />
      </button>
      {open && (
        <div className="finding-body">
          {f.value && <pre className="value">{f.value}</pre>}
          <p>
            <b>Why</b> {f.why}
          </p>
          <p>
            <b>Fix</b> {f.fix}
          </p>
          <div className="finding-actions">
            {f.docs && (
              <a href={f.docs} target="_blank" rel="noreferrer noopener">
                Docs ↗
              </a>
            )}
            {f.selector && onShow && (
              <button className="link" onClick={() => onShow(f.selector!)}>
                Show in page
              </button>
            )}
            <span className="muted rule-id">{f.ruleId}</span>
          </div>
        </div>
      )}
    </li>
  );
}

export function Findings({ findings, onShow, empty }: { findings: Finding[]; onShow?: (s: string) => void; empty?: string }) {
  if (!findings.length) return <p className="ok">✓ {empty ?? 'No issues found.'}</p>;
  return (
    <ul className="findings">
      {findings.map((f, i) => (
        <FindingRow key={`${f.ruleId}-${i}`} f={f} onShow={onShow} />
      ))}
    </ul>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <table className="kv">
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={i}>
            <th>{k}</th>
            <td>{v ?? <span className="muted">—</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <span className="muted">{children}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner" role="status">
      <span className="spinner-dot" /> {label ?? 'Loading…'}
    </span>
  );
}

export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  if (!/^https?:\/\//i.test(href)) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function download(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CopyButton({ text, label = 'Copy' }: { text: () => string; label?: string }) {
  const [done, setDone] = useState<null | boolean>(null);
  return (
    <button
      onClick={async () => {
        const t = text();
        const ok = await copyText(t);
        if (!ok) download('shirabe-report.md', t, 'text/markdown');
        setDone(ok);
        setTimeout(() => setDone(null), 1500);
      }}
    >
      {done === null ? label : done ? 'Copied ✓' : 'Downloaded'}
    </button>
  );
}

export function LenBadge({ n, max, unit = 'chars' }: { n: number; max?: number; unit?: string }) {
  const over = max !== undefined && n > max;
  return <span className={`badge ${over ? 'badge-warn' : ''}`}>{`${n} ${unit}`}</span>;
}
