import { useCallback, useEffect, useRef, useState } from 'react';
import { validateActionClicked } from '../../lib/messages';
import { ALL_SITES, requestHostAccess } from '../../lib/permissions';
import { DEFAULT_SETTINGS, loadSettings, type Settings as S } from '../../lib/settings';
import type { TabProps } from './props';
import { showInPage } from './tab';
import { Compare } from './tabs/Compare';
import { Content } from './tabs/Content';
import { Diff } from './tabs/Diff';
import { Meta } from './tabs/Meta';
import { Overview } from './tabs/Overview';
import { Schema } from './tabs/Schema';
import { Settings } from './tabs/Settings';
import { Share } from './tabs/Share';
import { Tech } from './tabs/Tech';
import { Muted } from './ui';
import { canAudit, useAudit, type TabInfo } from './useAudit';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'meta', label: 'Meta' },
  { id: 'share', label: 'Share' },
  { id: 'content', label: 'Content' },
  { id: 'schema', label: 'Schema' },
  { id: 'tech', label: 'Tech' },
  { id: 'compare', label: 'Compare' },
  { id: 'diff', label: 'Raw vs rendered' },
  { id: 'settings', label: '⚙', title: 'Settings' },
] as const;
type TabId = (typeof TABS)[number]['id'];

// Tests (and power users) can pin the panel to a tab: sidepanel.html?tabId=123
const pinnedTabId = (() => {
  const v = new URLSearchParams(location.search).get('tabId');
  return v && /^\d+$/.test(v) ? Number(v) : null;
})();

async function currentTab(): Promise<TabInfo | null> {
  const t = pinnedTabId !== null ? await chrome.tabs.get(pinnedTabId).catch(() => null) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!t || t.id === undefined) return null;
  return { id: t.id, url: t.url ?? t.pendingUrl ?? null, title: t.title ?? '' };
}

export function App() {
  const [view, setView] = useState<TabId>('overview');
  const [tab, setTab] = useState<TabInfo | null>(null);
  const [access, setAccess] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<S>(DEFAULT_SETTINGS);
  const [showError, setShowError] = useState<string | null>(null);
  const actions = useAudit();
  const { state, report, run } = actions;
  const lastAuto = useRef<string | null>(null);

  const refreshTab = useCallback(async () => {
    const t = await currentTab();
    setTab(t);
    setAccess(t?.url ? await canAudit(t.url) : false);
    return t;
  }, []);

  useEffect(() => {
    void loadSettings().then(setSettings);
    void refreshTab();
    const onActivated = () => pinnedTabId === null && void refreshTab();
    const onUpdated = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (info.status === 'complete' || info.url) void currentTab().then((t) => {
          if (t?.id === id) void refreshTab();
        });
    };
    const onPerm = () => void refreshTab();
    // Toolbar icon clicked in this window: activeTab now reveals the tab URL.
    const onMessage = (msg: unknown) => {
      const m = validateActionClicked(msg);
      if (m)
        void chrome.windows.getCurrent().then((w) => {
          if (w.id === m.windowId) void refreshTab();
        });
      return false;
    };
    chrome.runtime.onMessage.addListener(onMessage);
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.permissions.onAdded.addListener(onPerm);
    chrome.permissions.onRemoved.addListener(onPerm);
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.permissions.onAdded.removeListener(onPerm);
      chrome.permissions.onRemoved.removeListener(onPerm);
    };
  }, [refreshTab]);

  // Auto-audit on granted origins (never probes).
  useEffect(() => {
    if (!tab?.url || !access || !settings.autoAudit) return;
    const key = `${tab.id}|${tab.url}`;
    if (lastAuto.current === key) return;
    lastAuto.current = key;
    void run(tab);
  }, [tab, access, settings.autoAudit, run]);

  const onShow = useCallback(
    async (selector: string) => {
      if (!state.tabId) return;
      setShowError(null);
      const ok = await showInPage(state.tabId, selector).catch(() => false);
      if (!ok) setShowError('Element not found in the page (it may have changed since the audit).');
    },
    [state.tabId],
  );

  const http = !!tab?.url && /^https?:/i.test(tab.url);
  const pageNotices = view !== 'compare' && view !== 'settings';
  const stale = !!state.url && !!tab?.url && state.url !== tab.url;
  const host = (() => {
    try {
      return tab?.url ? new URL(tab.url).hostname : '';
    } catch {
      return '';
    }
  })();

  const props: TabProps = { state, report, actions, tab, settings, onShow };

  return (
    <div className="app">
      <header className="top">
        <div className="top-url">
          <div className="top-title">{tab?.title || 'Shirabe'}</div>
          <div className="break small muted" data-testid="tab-url">
            {tab?.url ?? 'Click the Shirabe icon on a page to inspect it.'}
          </div>
        </div>
        <div className="top-actions">
          {http && access === false && (
            <button
              className="primary"
              onClick={async () => {
                if (tab?.url && (await requestHostAccess([tab.url]))) {
                  const t = await refreshTab();
                  if (t && !settings.autoAudit) void run(t);
                }
              }}
            >
              Allow {host}
            </button>
          )}
          {http && access && (
            <button className="primary" onClick={() => tab && run(tab)} data-testid="audit">
              {state.url ? 'Re-audit' : 'Audit'}
            </button>
          )}
        </div>
      </header>
      {stale && <p className="notice small">The tab changed since this audit ({state.url}). Re-audit to update.</p>}
      {tab && !tab.url && pageNotices && (
        <div className="notice">
          <p>
            Shirabe cannot see this tab’s address yet. Click the <b>Shirabe icon</b> in the toolbar while on the page (this gives temporary access to the tab),
            then allow the site.
          </p>
          <button onClick={() => void chrome.permissions.request({ origins: ALL_SITES })}>
            Or grant access to all sites
          </button>
        </div>
      )}
      {tab?.url && !http && pageNotices && <p className="notice">Only http(s) pages can be audited.</p>}
      {http && access === false && pageNotices && (
        <p className="notice">
          Shirabe needs access to <b>{host}</b> to fetch the raw HTML (without cookies) and read the rendered page. Nothing leaves your browser.
        </p>
      )}
      {showError && <p className="error-line small">{showError}</p>}

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={view === t.id} className={view === t.id ? 'active' : ''} onClick={() => setView(t.id)} title={'title' in t ? t.title : undefined}>
            {t.label}
          </button>
        ))}
      </nav>

      <main className="content">
        {view === 'compare' ? (
          <Compare currentUrl={tab?.url ?? null} />
        ) : view === 'settings' ? (
          <Settings settings={settings} onChange={setSettings} />
        ) : !state.url ? (
          <Muted>{access ? 'Press Audit.' : ''}</Muted>
        ) : view === 'overview' ? (
          <Overview {...props} />
        ) : view === 'meta' ? (
          <Meta {...props} />
        ) : view === 'share' ? (
          <Share {...props} />
        ) : view === 'content' ? (
          <Content {...props} />
        ) : view === 'schema' ? (
          <Schema {...props} />
        ) : view === 'tech' ? (
          <Tech {...props} />
        ) : (
          <Diff {...props} />
        )}
      </main>
    </div>
  );
}
