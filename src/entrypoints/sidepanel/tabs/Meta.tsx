import { canonicals, description, favicons, header, hreflangs, metaByName, robotsDirectives, title } from '../../../lib/page';
import { GOOGLE_DESCRIPTION_FONT_PX, GOOGLE_TITLE_FONT_PX, textWidthPx } from '../../../lib/pixels';
import { platform } from '../../../lib/share/platforms';
import type { PageData } from '../../../lib/types';
import { samePage } from '../../../lib/url';
import type { TabProps } from '../props';
import { ExtLink, Findings, KV, Muted, Section } from '../ui';

const google = platform('google');

function Both({ raw, rendered, get }: { raw: PageData | null; rendered: PageData | null; get: (p: PageData) => string | null }) {
  const a = raw ? get(raw) : undefined;
  const b = rendered ? get(rendered) : undefined;
  if (a === undefined && b === undefined) return <Muted>—</Muted>;
  if (a === undefined || b === undefined || a === b) {
    const v = a !== undefined ? a : b;
    return v ? <span className="pre">{v}</span> : <Muted>(none)</Muted>;
  }
  return (
    <div className="both">
      <div>
        <span className="tag tag-raw">raw</span> {a ? <span className="pre">{a}</span> : <Muted>(none)</Muted>}
      </div>
      <div>
        <span className="tag tag-rendered">rendered</span> {b ? <span className="pre">{b}</span> : <Muted>(none)</Muted>}
      </div>
    </div>
  );
}

export function Meta({ state, report, onShow }: TabProps) {
  const raw = state.raw?.page ?? null;
  const rendered = state.rendered?.page ?? null;
  const p = raw ?? rendered;
  if (!p) return null;
  const t = title(p);
  const d = description(p);
  const finalUrl = state.raw?.fetch.finalUrl ?? state.url ?? '';
  const xr = header(state.raw?.fetch, 'x-robots-tag');
  const hl = hreflangs(p);
  const findings = report?.findings.filter((f) => ['meta', 'indexability', 'hreflang'].includes(f.category)) ?? [];

  return (
    <>
      <Section title="Head">
        <KV
          rows={[
            [
              'Title',
              <>
                <Both raw={raw} rendered={rendered} get={title} />
                {t && (
                  <div className="muted small">
                    {[...t].length} chars · ≈{textWidthPx(t, GOOGLE_TITLE_FONT_PX)}px / {google.truncate.titlePx}px
                  </div>
                )}
              </>,
            ],
            [
              'Description',
              <>
                <Both raw={raw} rendered={rendered} get={description} />
                {d && (
                  <div className="muted small">
                    {[...d].length} chars · ≈{textWidthPx(d, GOOGLE_DESCRIPTION_FONT_PX)}px / {google.truncate.descriptionPx}px desktop
                  </div>
                )}
              </>,
            ],
            [
              'Canonical',
              <>
                <Both raw={raw} rendered={rendered} get={(x) => canonicals(x, false).map((c) => c.rawHref).join('\n') || null} />
                {p && canonicals(p)[0]?.href && (
                  <div className="muted small">{samePage(canonicals(p)[0].href, finalUrl) ? 'self-referencing' : `≠ final URL ${finalUrl}`}</div>
                )}
              </>,
            ],
            ['Robots meta', <Both raw={raw} rendered={rendered} get={(x) => robotsDirectives(x).join(', ') || null} />],
            ['X-Robots-Tag', xr ?? <Muted>(none)</Muted>],
            ['Viewport', <Both raw={raw} rendered={rendered} get={(x) => metaByName(x, 'viewport', false)[0] ?? null} />],
            ['lang', <Both raw={raw} rendered={rendered} get={(x) => x.lang} />],
            ['Charset', <Both raw={raw} rendered={rendered} get={(x) => x.charset} />],
            ['theme-color', <Both raw={raw} rendered={rendered} get={(x) => metaByName(x, 'theme-color')[0] ?? null} />],
            [
              'Icons',
              favicons(p).length ? (
                <ul className="plain">
                  {favicons(p).map((f, i) => (
                    <li key={i}>
                      <span className="tag">{f.rel}</span> {f.sizes && <Muted>{f.sizes} </Muted>}
                      <ExtLink href={f.href ?? ''}>{f.rawHref}</ExtLink>
                    </li>
                  ))}
                </ul>
              ) : (
                <Muted>(none)</Muted>
              ),
            ],
          ]}
        />
      </Section>

      <Section title={`hreflang (${hl.length})`}>
        {hl.length ? (
          <table className="grid">
            <thead>
              <tr>
                <th>lang</th>
                <th>URL</th>
                <th>self?</th>
              </tr>
            </thead>
            <tbody>
              {hl.map((h, i) => (
                <tr key={i}>
                  <td>{h.lang}</td>
                  <td className="break">
                    <ExtLink href={h.href ?? ''}>{h.rawHref}</ExtLink>
                  </td>
                  <td>{h.href && samePage(h.href, finalUrl) ? '✓' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Muted>No hreflang annotations.</Muted>
        )}
        {state.site?.sitemap?.alternates.length ? (
          <p className="small muted">Sitemap also declares {state.site.sitemap.alternates.length} alternates for this URL.</p>
        ) : null}
      </Section>

      <Section title="Findings: indexability, meta, hreflang">
        <Findings findings={findings} onShow={onShow} />
      </Section>
    </>
  );
}
