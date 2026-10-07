import { useEffect, useState } from 'react';
import { ALL_SITES, grantedOrigins } from '../../../lib/permissions';
import { saveSettings, type Settings as S } from '../../../lib/settings';
import { Muted, Section } from '../ui';

export function Settings({ settings, onChange }: { settings: S; onChange: (s: S) => void }) {
  const [origins, setOrigins] = useState<string[]>([]);
  const refresh = () => grantedOrigins().then(setOrigins);
  useEffect(() => {
    void refresh();
  }, []);
  const update = (s: S) => {
    onChange(s);
    void saveSettings(s);
  };
  const all = origins.includes('<all_urls>');

  return (
    <>
      <Section title="Site access">
        <p className="small">
          Shirabe asks for access per site the first time you audit it. Granting all sites lets it fetch share images, robots.txt and probe links on any host without
          asking again. Fetches never send cookies.
        </p>
        <div className="row wrap">
          {all ? (
            <button onClick={async () => (await chrome.permissions.remove({ origins: ALL_SITES })) && refresh()}>Revoke all-sites access</button>
          ) : (
            <button onClick={async () => (await chrome.permissions.request({ origins: ALL_SITES })) && refresh()}>Grant access to all sites</button>
          )}
        </div>
        <ul className="plain small">
          {origins.length === 0 && <Muted>No site granted yet.</Muted>}
          {origins
            .filter((o) => o !== '<all_urls>')
            .map((o) => (
              <li key={o}>
                {o}{' '}
                <button className="link" onClick={async () => (await chrome.permissions.remove({ origins: [o] })) && refresh()}>
                  revoke
                </button>
              </li>
            ))}
        </ul>
      </Section>

      <Section title="Behaviour">
        <label className="row">
          <input type="checkbox" checked={settings.autoAudit} onChange={(e) => update({ ...settings, autoAudit: e.target.checked })} />
          Audit automatically when the tab changes (sites with access only; probes never run automatically)
        </label>
        <label className="row">
          Broken-link probe: check at most
          <input
            type="number"
            min={10}
            max={1000}
            value={settings.linkCheckMax}
            onChange={(e) => update({ ...settings, linkCheckMax: Math.max(10, Math.min(1000, Number(e.target.value) || 150)) })}
          />
          links
        </label>
      </Section>

      <Section title="About">
        <p className="small">
          Shirabe (調べ) — local only: no backend, no telemetry, no account. Platform preview rules live in <code>src/rules/share/*.json</code> with their sources and
          verification date.
        </p>
      </Section>
    </>
  );
}
