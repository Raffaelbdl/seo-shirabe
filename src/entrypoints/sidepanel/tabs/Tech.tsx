import { useState } from 'react';
import { canonical, description, hasNoindex, kb, robotsDirectives, socialMeta, title } from '../../../lib/page';
import { FRAMEWORK_LABEL, THRESHOLDS } from '../../../lib/rules/performance';
import { BOTS } from '../../../lib/share/platforms';
import type { Probes, RawAudit } from '../../../lib/types';
import type { TabProps } from '../props';
import { ExtLink, Findings, KV, Muted, Section, Spinner } from '../ui';

function botDiff(a: RawAudit, b: RawAudit): { field: string; browser: string; bot: string }[] {
  const pa = a.page;
  const pb = b.page;
  const rows: [string, (r: RawAudit) => string][] = [
    ['status', (r) => String(r.fetch.error ?? r.fetch.status)],
    ['final URL', (r) => r.fetch.finalUrl],
    ['HTML size', (r) => kb(r.fetch.bytes)],
    ['title', (r) => (r.page ? (title(r.page) ?? '') : '')],
    ['description', (r) => (r.page ? (description(r.page) ?? '') : '')],
    ['canonical', (r) => (r.page ? (canonical(r.page) ?? '') : '')],
    ['robots', (r) => (r.page ? robotsDirectives(r.page).join(', ') : '')],
    ['og:title', (r) => (r.page ? (socialMeta(r.page, 'og:title')?.value ?? '') : '')],
    ['og:image', (r) => (r.page ? (socialMeta(r.page, 'og:image')?.value ?? '') : '')],
    ['words', (r) => String(r.page?.wordCount ?? 0)],
    ['links', (r) => String(r.page?.anchors.length ?? 0)],
  ];
  const out = rows.map(([field, get]) => ({ field, browser: get(a), bot: get(b) }));
  if (!pa || !pb) return out;
  return out;
}

const PROBES: { id: keyof Probes; label: string; detail: string }[] = [
  { id: 'soft404', label: 'Soft 404', detail: 'Fetches this path with a random last segment and checks it returns 404.' },
  { id: 'canonical', label: 'Canonical target', detail: 'Fetches the canonical URL: 200, indexable, self-canonical?' },
  { id: 'hreflang', label: 'hreflang reciprocity', detail: 'Fetches every alternate: 200, indexable, links back?' },
  { id: 'links', label: 'Broken links', detail: 'HEAD (then GET) on the page links, 4 at a time, rate-limited per origin. Only origins you granted are checked.' },
];

export function Tech({ state, report, actions, settings, onShow }: TabProps) {
  const [botId, setBotId] = useState(BOTS[0].id);
  const f = state.raw?.fetch;
  const raw = state.raw?.page ?? null;
  const vitals = state.rendered?.vitals;
  const site = state.site;
  const findings = report?.findings.filter((x) => x.category === 'performance' || x.category === 'ai') ?? [];
  const p = state.probes;

  return (
    <>
      <Section title="Response">
        {!f ? (
          state.running.raw ? <Spinner /> : <Muted>{state.errors.raw ?? 'Not fetched.'}</Muted>
        ) : (
          <KV
            rows={[
              ['Status', f.error ? <span className="bad">{f.error}</span> : `${f.status} ${f.statusText}`],
              ['Final URL', <span className="break">{f.finalUrl}</span>],
              [
                'Redirects',
                f.redirects.length ? (
                  <ol className="plain small">
                    {f.redirects.map((h, i) => (
                      <li key={i} className="break">
                        {h.status || '3xx'} {h.url} → {h.location}
                      </li>
                    ))}
                  </ol>
                ) : (
                  'none'
                ),
              ],
              ['Content-Type', f.contentType],
              ['HTML weight', `${kb(f.bytes)} (decompressed)${f.truncated ? ' — truncated at cap' : ''}`],
              ['Time', `${f.timingMs} ms`],
            ]}
          />
        )}
        {f && f.headers.length > 0 && (
          <details>
            <summary>Response headers ({f.headers.length})</summary>
            <table className="grid small">
              <tbody>
                {f.headers.map(([k, v], i) => (
                  <tr key={i}>
                    <th>{k}</th>
                    <td className="break">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </Section>

      {raw && (
        <Section title="Weight breakdown (raw HTML)">
          <KV
            rows={[
              ...raw.framework.map((fw): [string, string] => [FRAMEWORK_LABEL[fw.kind], `${kb(fw.bytes)}${fw.bytes > THRESHOLDS.frameworkBytes ? ' ⚠' : ''}`]),
              ['Inline scripts', `${kb(raw.inlineScriptBytes)} in ${raw.scriptCount} <script>`],
              ['Inline CSS', `${kb(raw.inlineStyleBytes)} in ${raw.inlineStyleCount} <style>`],
              ['@font-face (inline)', String(raw.fontFaceCount)],
              ['data: URIs', `${raw.dataUriCount} (${kb(raw.dataUriBytes)})`],
              ['Stylesheets', String(raw.stylesheetCount)],
              ['Elements in <body>', String(raw.bodyElementCount)],
            ]}
          />
        </Section>
      )}

      <Section title="Web Vitals (this tab)" right={<button className="link" onClick={() => actions.refreshVitals()}>refresh</button>}>
        {vitals ? (
          <KV
            rows={(['LCP', 'CLS', 'INP', 'TTFB', 'FCP'] as const).map((k) => [
              k,
              vitals[k] === undefined ? <Muted>not yet (interact with the page for INP)</Muted> : k === 'CLS' ? vitals[k]!.toFixed(3) : `${Math.round(vitals[k]!)} ms`,
            ])}
          />
        ) : (
          <Muted>Not available — the collector is injected at page load once access is granted. Reload the tab, then re-audit.</Muted>
        )}
        {state.rendered?.page.resources && (
          <p className="small muted">
            {state.rendered.page.resources.count} resources, {kb(state.rendered.page.resources.transferBytes)} transferred (
            {Object.entries(state.rendered.page.resources.byType)
              .map(([t, v]) => `${t} ${v.count}`)
              .join(', ')}
            )
          </p>
        )}
      </Section>

      <Section title="Site files">
        {!site ? (
          state.running.site ? <Spinner /> : <Muted>{state.errors.site ?? '—'}</Muted>
        ) : (
          <KV
            rows={[
              [
                <ExtLink href={site.robots?.url ?? ''}>robots.txt</ExtLink>,
                site.robots ? (
                  site.robots.found ? (
                    <ul className="plain small">
                      {site.robots.agents.map((a) => (
                        <li key={a.agent}>
                          {a.allowed ? '✓' : '✗'} {a.agent} <Muted>{a.rule ?? 'no matching rule'}</Muted>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    `not found (HTTP ${site.robots.status || site.robots.error}) — everything allowed`
                  )
                ) : null,
              ],
              [
                'Sitemap',
                site.sitemap ? (
                  <div className="small">
                    {site.sitemap.found ? (site.sitemap.listed ? `✓ listed as ${site.sitemap.listedAs}` : `✗ not listed (${site.sitemap.urlCount} URLs read${site.sitemap.capped ? ', capped' : ''})`) : 'not found'}
                    <ul className="plain">
                      {site.sitemap.checked.map((s) => (
                        <li key={s} className="break muted">
                          {s}
                        </li>
                      ))}
                      {site.sitemap.errors.map((e) => (
                        <li key={e} className="break bad">
                          {e}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              ],
              ['llms.txt', site.llms ? (site.llms.present ? <ExtLink href={site.llms.url}>present ({kb(site.llms.bytes)})</ExtLink> : 'absent') : null],
              ['Homepage', site.homepage ? `${site.homepage.status} ${site.homepage.url}${site.homepage.isCurrentPage ? ' (this page)' : ''}` : null],
            ]}
          />
        )}
      </Section>

      <Section title="Fetch as bot">
        <div className="row wrap">
          <select value={botId} onChange={(e) => setBotId(e.target.value)} aria-label="Bot user agent">
            {BOTS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
          <button onClick={() => actions.fetchAsBot(botId)} disabled={!state.url || !!state.running.bot}>
            Fetch
          </button>
          {state.running.bot && <Spinner />}
        </div>
        {state.errors.bot && <p className="error-line">{state.errors.bot}</p>}
        {state.bot && state.raw && (
          <>
            <p className="small muted">User-Agent: {BOTS.find((b) => b.id === state.bot!.botId)?.userAgent}</p>
            <table className="grid small" data-testid="bot-diff">
              <thead>
                <tr>
                  <th></th>
                  <th>browser UA</th>
                  <th>{BOTS.find((b) => b.id === state.bot!.botId)?.label}</th>
                </tr>
              </thead>
              <tbody>
                {botDiff(state.raw, state.bot.raw).map((r) => (
                  <tr key={r.field} className={r.browser !== r.bot ? 'diff-row' : ''}>
                    <th>{r.field}</th>
                    <td className="break">{r.browser}</td>
                    <td className="break">{r.bot}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {botDiff(state.raw, state.bot.raw).some((r) => r.browser !== r.bot && r.field !== 'HTML size') ? (
              <p className="notice">The bot receives different HTML (prerender service, cloaking or bot blocking).</p>
            ) : (
              <p className="ok">✓ Same key signals for the bot and a browser.</p>
            )}
            {state.bot.raw.page && hasNoindex(robotsDirectives(state.bot.raw.page)) && <p className="error-line">The bot gets a noindex page.</p>}
          </>
        )}
      </Section>

      <Section title="Probes (opt-in)">
        <ul className="plain probes">
          {PROBES.map((pr) => (
            <li key={pr.id}>
              <button onClick={() => actions.probe(pr.id, settings.linkCheckMax)} disabled={!state.url || !!state.running[pr.id]}>
                {pr.label}
              </button>{' '}
              {state.running[pr.id] && <Spinner label="" />}
              <span className="small muted">{pr.detail}</span>
              {state.errors[pr.id] && <div className="error-line">{state.errors[pr.id]}</div>}
            </li>
          ))}
        </ul>
        {p.soft404 && (
          <p className="small">
            Soft-404 probe: <code className="break">{p.soft404.probeUrl}</code> → {p.soft404.result.error ?? p.soft404.result.status}
            {p.soft404.result.finalUrl !== p.soft404.probeUrl && ` (→ ${p.soft404.result.finalUrl})`}
          </p>
        )}
        {p.canonical && (
          <p className="small">
            Canonical target: {p.canonical.canonical} → {p.canonical.result.error ?? p.canonical.result.status}
            {p.canonical.result.noindex ? ', noindex' : ''}, canonical: {p.canonical.result.canonical ?? '(none)'}
          </p>
        )}
        {p.hreflang && (
          <table className="grid small">
            <thead>
              <tr>
                <th>lang</th>
                <th>URL</th>
                <th>status</th>
                <th>links back</th>
              </tr>
            </thead>
            <tbody>
              {p.hreflang.alternates.map((a, i) => (
                <tr key={i}>
                  <td>{a.lang}</td>
                  <td className="break">{a.href}</td>
                  <td>{a.result.error ?? a.result.status}{a.result.noindex ? ' noindex' : ''}</td>
                  <td>{a.linksBack ? '✓' : '✗'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {p.links && (
          <div className="small">
            <p>
              {p.links.checked.filter((c) => !c.skipped).length} checked
              {p.links.capped ? ` (capped at ${settings.linkCheckMax})` : ''} · {p.links.checked.filter((c) => !c.skipped && !c.ok).length} broken ·{' '}
              {p.links.checked.filter((c) => c.skipped === 'no-permission').length} skipped (no access)
            </p>
            <ul className="plain">
              {p.links.checked
                .filter((c) => !c.skipped && !c.ok)
                .map((c) => (
                  <li key={c.url} className="break bad">
                    {c.error ?? c.status} {c.url}
                  </li>
                ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Findings: performance, AI & crawlers">
        <Findings findings={findings} onShow={onShow} />
      </Section>
    </>
  );
}
