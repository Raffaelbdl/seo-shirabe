import { useState } from 'react';
import { requestHostAccess } from '../../../lib/permissions';
import { GOOGLE_DESCRIPTION_FONT_PX, GOOGLE_TITLE_FONT_PX, truncateChars, truncateToPx } from '../../../lib/pixels';
import { genericImageIssues, platformImageIssues } from '../../../lib/share/images';
import { PLATFORMS, type PlatformRule } from '../../../lib/share/platforms';
import { resolvePreview, type Resolved, type SharePreview } from '../../../lib/share/resolve';
import type { ShareImageCheck } from '../../../lib/types';
import type { TabProps } from '../props';
import { ExtLink, Findings, Muted, Section, SevIcon } from '../ui';

function Src({ r, label }: { r: Resolved; label: string }) {
  return (
    <li>
      {label} ← {r.source ? <code>{r.source}</code> : <Muted>nothing</Muted>}
    </li>
  );
}

function CardImage({ pv, check, blob, ratio }: { pv: SharePreview; check?: ShareImageCheck; blob?: string; ratio: number }) {
  if (!pv.image.value) return <div className="card-img card-img-empty" style={{ aspectRatio: String(ratio) }}>no image</div>;
  return (
    <div className="card-img" style={{ aspectRatio: String(ratio) }}>
      {blob ? (
        <img src={blob} alt={pv.imageAlt.value ?? ''} width={check?.width ?? undefined} height={check?.height ?? undefined} />
      ) : (
        <span className="muted small">{check ? (check.error ?? `image not displayed (${check.format}, HTTP ${check.status})`) : 'checking image…'}</span>
      )}
    </div>
  );
}

function GoogleCard({ pv, url }: { pv: SharePreview; url: string }) {
  const [mobile, setMobile] = useState(false);
  const rule = pv.platform;
  const t = pv.title.value ? truncateToPx(pv.title.value, GOOGLE_TITLE_FONT_PX, rule.truncate.titlePx ?? 600) : null;
  const d = pv.description.value
    ? truncateToPx(pv.description.value, GOOGLE_DESCRIPTION_FONT_PX, mobile ? (rule.truncate.descriptionPxMobile ?? 680) : (rule.truncate.descriptionPx ?? 920))
    : null;
  let crumbs = url;
  try {
    const u = new URL(url);
    crumbs = [u.hostname, ...decodeURIComponent(u.pathname).split('/').filter(Boolean)].join(' › ');
  } catch {
    /* keep */
  }
  return (
    <div className={`gcard ${mobile ? 'gcard-mobile' : ''}`}>
      <div className="row">
        <label className="small">
          <input type="checkbox" checked={mobile} onChange={(e) => setMobile(e.target.checked)} /> mobile width
        </label>
      </div>
      <div className="g-site">{pv.siteName.value}</div>
      <div className="g-url">{crumbs}</div>
      <div className="g-title">{t ? t.text : <Muted>(Google will generate a title)</Muted>}</div>
      <div className="g-desc">{d ? d.text : <Muted>(snippet generated from page text)</Muted>}</div>
      <ul className="sources small">
        <Src r={pv.title} label="title" />
        <Src r={pv.description} label="description" />
        <Src r={pv.siteName} label="site name" />
      </ul>
    </div>
  );
}

function SocialCard({ pv, check, blob }: { pv: SharePreview; check?: ShareImageCheck; blob?: string }) {
  const rule = pv.platform;
  const isX = rule.platform === 'x';
  const card = pv.cardType ?? rule.cardType?.default ?? null;
  const small = (isX && card === 'summary') || rule.image.smallThumbnail;
  const ratio = isX ? (small ? 1 : 2) : (rule.image.displayRatio ?? (check?.width && check.height ? check.width / check.height : 1.91));
  const t = pv.title.value ? truncateChars(pv.title.value, rule.truncate.title) : null;
  const d = pv.description.value ? truncateChars(pv.description.value, rule.truncate.description) : null;
  const issues = check ? [...genericImageIssues(check), ...platformImageIssues(check, rule, pv.cardType)] : [];
  return (
    <div className={`card card-${rule.platform} ${small ? 'card-small' : ''}`} style={rule.displays.themeColor && pv.themeColor.value ? { borderLeftColor: pv.themeColor.value } : undefined}>
      <div className="card-body">
        {!small && <CardImage pv={pv} check={check} blob={blob} ratio={ratio} />}
        {small && <CardImage pv={pv} check={check} blob={blob} ratio={1} />}
        <div className="card-text">
          {rule.displays.siteName && pv.siteName.value && <div className="card-site">{pv.siteName.value}</div>}
          {rule.displays.title && t && <div className="card-title">{t.text}</div>}
          {rule.displays.description && d && <div className="card-desc">{d.text}</div>}
          {rule.displays.domain && <div className="card-domain">{isX ? `From ${pv.host}` : pv.host}</div>}
        </div>
      </div>
      <ul className="sources small">
        <Src r={pv.title} label={`title${rule.displays.title ? '' : ' (not displayed)'}`} />
        <Src r={pv.description} label={`description${rule.displays.description ? '' : ' (not displayed)'}`} />
        <Src r={pv.image} label="image" />
        {rule.cardType && (
          <li>
            card ← {pv.cardType ? <code>{pv.cardType}</code> : <Muted>missing, defaults to {rule.cardType.default}</Muted>}
          </li>
        )}
      </ul>
      {issues.length > 0 && (
        <ul className="plain small">
          {issues.map((i, k) => (
            <li key={k}>
              <SevIcon s={i.severity} /> {i.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Share({ state, report, actions, onShow }: TabProps) {
  const raw = state.raw?.page;
  const [open, setOpen] = useState<string | null>(null);
  if (state.raw && !raw) return <p className="error-line">No raw HTML: share previews need the server response ({state.raw.fetch.error ?? state.raw.fetch.status}).</p>;
  if (!raw) return null;
  const url = state.raw!.fetch.finalUrl;
  const checkFor = (u: string | null) => (u ? state.images.find((c) => c.url === u) : undefined);
  const corsBlocked = state.images.filter((c) => c.error && /CORS|host access/i.test(c.error));
  const findings = report?.findings.filter((f) => f.category === 'share') ?? [];

  return (
    <>
      <p className="small muted">Built from the raw HTML only — scrapers do not run JavaScript. Platform rules: src/rules/share/*.json.</p>
      {corsBlocked.length > 0 && (
        <p className="notice">
          The share image is on another host. Grant access to check it:{' '}
          <button
            onClick={async () => {
              if (await requestHostAccess(corsBlocked.map((c) => c.url))) await actions.recheckImage();
            }}
          >
            Grant {corsBlocked.map((c) => c.host).join(', ')}
          </button>
        </p>
      )}
      {PLATFORMS.map((rule: PlatformRule) => {
        const pv = resolvePreview(raw, rule);
        const check = checkFor(pv.image.value);
        return (
          <Section
            key={rule.platform}
            title={rule.name}
            right={
              <span className="row">
                {rule.debugger && <ExtLink href={rule.debugger.url.replace('{url}', encodeURIComponent(url))}>{rule.debugger.label} ↗</ExtLink>}
                <button className="link" onClick={() => setOpen(open === rule.platform ? null : rule.platform)}>
                  rules
                </button>
              </span>
            }
          >
            {rule.platform === 'google' ? <GoogleCard pv={pv} url={url} /> : <SocialCard pv={pv} check={check} blob={pv.image.value ? state.blobs[pv.image.value] : undefined} />}
            {rule.refreshNote && <p className="small muted">Refresh: {rule.refreshNote}</p>}
            {open === rule.platform && (
              <div className="small rules-detail">
                <ul>
                  {rule.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
                <p>
                  Verified {rule.lastVerified}. Sources:{' '}
                  {rule.source.map((s, i) => (
                    <span key={s}>
                      {i > 0 && ' · '}
                      <ExtLink href={s}>{new URL(s).hostname}</ExtLink>
                    </span>
                  ))}
                </p>
              </div>
            )}
          </Section>
        );
      })}

      <Section title="Share images">
        {state.running.images && <Muted>Checking images…</Muted>}
        {!state.images.length && !state.running.images && <Muted>No og:image / twitter:image.</Muted>}
        {state.images.map((c) => (
          <div key={c.url} className="imgcheck">
            <div className="break small">
              <code>{c.source}</code> <ExtLink href={c.url}>{c.url}</ExtLink>
            </div>
            <div className="small">
              HTTP {c.status || '—'} · {c.contentType ?? 'no type'} · {Math.round(c.bytes / 1024)} KB · {c.format}
              {c.width ? ` · ${c.width}×${c.height} (${(c.width / (c.height || 1)).toFixed(2)}:1)` : ''}
            </div>
            {state.blobs[c.url] && c.width && c.height && (
              <div className="crops">
                {[
                  ['1.91:1 (Facebook, LinkedIn)', 1.91],
                  ['2:1 (X large)', 2],
                  ['1:1 (X summary, WhatsApp small)', 1],
                ].map(([label, r]) => (
                  <figure key={label as string}>
                    <div className="crop" style={{ aspectRatio: String(r) }}>
                      <img src={state.blobs[c.url]} alt="" width={c.width ?? undefined} height={c.height ?? undefined} />
                    </div>
                    <figcaption className="small muted">{label as string}</figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>
        ))}
        <p className="small">
          Telegram: send the URL to <code>@WebpageBot</code> to refresh its cache. Google:{' '}
          <ExtLink href={`https://search.google.com/test/rich-results?url=${encodeURIComponent(url)}`}>Rich Results Test ↗</ExtLink> ·{' '}
          <ExtLink href="https://support.google.com/webmasters/answer/9012289">URL Inspection ↗</ExtLink>
        </p>
      </Section>

      <Section title="Findings: share">
        <Findings findings={findings} onShow={onShow} />
      </Section>
    </>
  );
}
