import { useEffect, useMemo, useState } from 'react';
import { bestColumns, METRIC_ROWS, toCsv, toJson, toMarkdown, type CompareRun, type CompareSet } from '../../../lib/compare';
import { callBg } from '../../../lib/messages';
import { requestHostAccess } from '../../../lib/permissions';
import { deleteRuns, loadRuns, loadSets, saveRun, saveSets } from '../../../lib/settings';
import type { PageData } from '../../../lib/types';
import { isHttpUrl, samePage } from '../../../lib/url';
import { extractRendered } from '../tab';
import { CopyButton, download, Muted, Section, Spinner } from '../ui';

const newId = () => Math.random().toString(36).slice(2, 10);

const label = (u: string) => {
  try {
    const p = new URL(u);
    return p.hostname.replace(/^www\./, '') + decodeURIComponent(p.pathname);
  } catch {
    return u;
  }
};

async function renderedForOpenTabs(urls: string[]): Promise<Record<string, PageData>> {
  const tabs = await chrome.tabs.query({});
  const out: Record<string, PageData> = {};
  for (const url of urls) {
    const tab = tabs.find((t) => t.id !== undefined && t.url && samePage(t.url, url) && t.status === 'complete');
    if (!tab?.id || !tab.url) continue;
    try {
      out[url] = await extractRendered(tab.id, tab.url);
    } catch {
      /* tab not scriptable */
    }
  }
  return out;
}

export function Compare({ currentUrl }: { currentUrl: string | null }) {
  const [sets, setSets] = useState<CompareSet[] | null>(null);
  const [setId, setSetId] = useState<string | null>(null);
  const [runs, setRuns] = useState<CompareRun[]>([]);
  const [runIdx, setRunIdx] = useState(0);
  const [newUrl, setNewUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setName, setSetName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    void loadSets().then((s) => {
      setSets(s);
      setSetId(s[0]?.id ?? null);
    });
  }, []);
  useEffect(() => {
    if (setId) void loadRuns(setId).then((r) => (setRuns(r), setRunIdx(0)));
  }, [setId]);

  const set = sets?.find((s) => s.id === setId) ?? null;
  const run = runs[runIdx] ?? null;
  const update = async (next: CompareSet[]) => {
    setSets(next);
    await saveSets(next);
  };
  const updateSet = (fn: (s: CompareSet) => CompareSet) => set && update(sets!.map((s) => (s.id === set.id ? fn(s) : s)));
  const addUrl = (u: string) => {
    if (!isHttpUrl(u) || !set || set.urls.includes(u) || set.urls.length >= 20) return;
    void updateSet((s) => ({ ...s, urls: [...s.urls, u] }));
  };

  const start = async () => {
    if (!set || !set.urls.length) return;
    setError(null);
    // Ask for the origins first, while the click still counts as a user gesture.
    await requestHostAccess(set.urls).catch(() => false);
    setBusy(true);
    try {
      const rendered = await renderedForOpenTabs(set.urls);
      const results = await callBg({ type: 'compare', urls: set.urls, rendered });
      const r: CompareRun = { id: newId(), setId: set.id, at: Date.now(), results };
      setRuns(await saveRun(r));
      setRunIdx(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const best = useMemo(() => (run ? METRIC_ROWS.map((row) => new Set(bestColumns(row, run.results))) : []), [run]);

  if (!sets) return <Spinner />;
  return (
    <>
      <Section title="Comparison set">
        <div className="row wrap">
          <select value={setId ?? ''} onChange={(e) => setSetId(e.target.value)} aria-label="Comparison set">
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.urls.length})
              </option>
            ))}
          </select>
          {set && confirmDelete ? (
            <>
              <span className="small">Delete “{set.name}” and its history?</span>
              <button
                onClick={async () => {
                  await deleteRuns(set.id);
                  const next = sets.filter((s) => s.id !== set.id);
                  await update(next);
                  setSetId(next[0]?.id ?? null);
                  setConfirmDelete(false);
                }}
              >
                Delete
              </button>
              <button className="link" onClick={() => setConfirmDelete(false)}>
                cancel
              </button>
            </>
          ) : (
            set && (
              <button className="link" onClick={() => setConfirmDelete(true)}>
                delete set
              </button>
            )
          )}
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            const name = setName.trim().slice(0, 80);
            if (!name) return;
            const s: CompareSet = { id: newId(), name, urls: [], createdAt: Date.now() };
            void update([...sets, s]).then(() => setSetId(s.id));
            setSetName('');
          }}
        >
          <input placeholder="New set name" value={setName} onChange={(e) => setSetName(e.target.value)} aria-label="New set name" />
          <button type="submit" disabled={!setName.trim()}>
            Create set
          </button>
          {set && (
            <button
              type="button"
              className="link"
              disabled={!setName.trim()}
              onClick={() => {
                void updateSet((s) => ({ ...s, name: setName.trim().slice(0, 80) }));
                setSetName('');
              }}
            >
              rename current
            </button>
          )}
        </form>
        {set && (
          <>
            <ol className="urls">
              {set.urls.map((u) => (
                <li key={u} className="break small">
                  {u}{' '}
                  <button className="link" onClick={() => void updateSet((s) => ({ ...s, urls: s.urls.filter((x) => x !== u) }))} aria-label={`Remove ${u}`}>
                    ✕
                  </button>
                </li>
              ))}
            </ol>
            <div className="row wrap">
              <button disabled={!currentUrl || !isHttpUrl(currentUrl) || set.urls.includes(currentUrl ?? '')} onClick={() => currentUrl && addUrl(currentUrl)}>
                Add current tab
              </button>
              <form
                className="row grow"
                onSubmit={(e) => {
                  e.preventDefault();
                  addUrl(newUrl.trim());
                  setNewUrl('');
                }}
              >
                <input type="url" placeholder="https://…" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} aria-label="URL to add" />
                <button type="submit">Add</button>
              </form>
            </div>
            <div className="row">
              <button className="primary" onClick={start} disabled={busy || !set.urls.length}>
                {busy ? 'Running…' : 'Run comparison'}
              </button>
              {busy && <Spinner label="Fetching raw HTML (2 at a time)…" />}
            </div>
            {error && <p className="error-line">{error}</p>}
            <p className="small muted">Raw HTML audit for every URL. Rendered metrics are added for URLs currently open in a tab.</p>
          </>
        )}
      </Section>

      {run && set && (
        <Section
          title="Results"
          right={
            <span className="row">
              <CopyButton label="Copy Markdown" text={() => toMarkdown(set, run)} />
              <button onClick={() => download(`${set.name}.csv`, toCsv(run), 'text/csv')}>CSV</button>
              <button onClick={() => download(`${set.name}.json`, toJson(set, run), 'application/json')}>JSON</button>
            </span>
          }
        >
          <div className="row">
            <span className="small">Run:</span>
            <select value={runIdx} onChange={(e) => setRunIdx(Number(e.target.value))} aria-label="Run">
              {runs.map((r, i) => (
                <option key={r.id} value={i}>
                  {new Date(r.at).toLocaleString()}
                </option>
              ))}
            </select>
            <Muted>{runs.length} kept</Muted>
          </div>
          <div className="table-scroll">
            <table className="grid compare" data-testid="compare-table">
              <thead>
                <tr>
                  <th></th>
                  {run.results.map((m) => (
                    <th key={m.url} className="break">
                      {label(m.url)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRIC_ROWS.map((row, ri) => (
                  <tr key={row.key}>
                    <th>{row.label}</th>
                    {run.results.map((m, ci) => {
                      const prev = runs[runIdx + 1]?.results.find((x) => x.url === m.url);
                      const before = prev ? row.show(prev) : null;
                      return (
                        <td key={m.url} className={`break ${best[ri]?.has(ci) ? 'best' : ''}`} title={before && before !== row.show(m) ? `previous run: ${before}` : undefined}>
                          {row.show(m)}
                          {before && before !== row.show(m) && <span className="changed"> •</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">Highlighted = best in row. • = changed since the previous run (hover for the old value).</p>
        </Section>
      )}
    </>
  );
}
