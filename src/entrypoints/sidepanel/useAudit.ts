import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { callBg } from '../../lib/messages';
import { canonical } from '../../lib/page';
import { hasHostAccess } from '../../lib/permissions';
import { audit } from '../../lib/rules';
import { checkShareImage } from '../../lib/share/images';
import { PLATFORM_BOT, PLATFORMS, SOCIAL_PLATFORMS } from '../../lib/share/platforms';
import { shareImageCandidates } from '../../lib/share/resolve';
import type { AuditReport, PageData, Probes, RawAudit, RenderedAudit, ShareImageCheck, SiteAudit } from '../../lib/types';
import { extractRendered, getVitals } from './tab';

export interface TabInfo {
  id: number;
  url: string | null;
  title: string;
}

type Step = 'raw' | 'rendered' | 'site' | 'images';

export interface AuditState {
  url: string | null;
  tabId: number | null;
  raw: RawAudit | null;
  rendered: RenderedAudit | null;
  site: SiteAudit | null;
  probes: Probes;
  images: ShareImageCheck[];
  blobs: Record<string, string>;
  running: Partial<Record<Step | keyof Probes | 'bot' | 'shareBots', boolean>>;
  errors: Partial<Record<Step | keyof Probes | 'bot' | 'shareBots', string>>;
  bot: { botId: string; raw: RawAudit } | null;
  /** Raw HTML fetched with each platform's crawler user agent, keyed by bot id. */
  shareBots: Record<string, RawAudit>;
  at: number | null;
}

const EMPTY: AuditState = { url: null, tabId: null, raw: null, rendered: null, site: null, probes: {}, images: [], blobs: {}, running: {}, errors: {}, bot: null, shareBots: {}, at: null };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useAudit() {
  const [state, setState] = useState<AuditState>(EMPTY);
  const runId = useRef(0);
  const blobsRef = useRef<string[]>([]);

  const patch = useCallback((id: number, fn: (s: AuditState) => Partial<AuditState>) => {
    setState((s) => (id === runId.current ? { ...s, ...fn(s) } : s));
  }, []);
  const setRunning = (id: number, key: string, on: boolean, error?: string) =>
    patch(id, (s) => ({ running: { ...s.running, [key]: on }, errors: error === undefined ? s.errors : { ...s.errors, [key]: error } }));

  const revokeBlobs = () => {
    for (const b of blobsRef.current) URL.revokeObjectURL(b);
    blobsRef.current = [];
  };

  const checkImages = useCallback(async (id: number, raw: RawAudit, extra: PageData[] = [], skip: string[] = []) => {
    if (!raw.page) return;
    const seen = new Set(skip);
    const candidates = [raw.page, ...extra]
      .flatMap((p) => shareImageCandidates(p, SOCIAL_PLATFORMS))
      .filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));
    if (!candidates.length) return;
    setRunning(id, 'images', true);
    const checks: ShareImageCheck[] = [];
    const blobs: Record<string, string> = {};
    for (const c of candidates.slice(0, 4)) {
      const { check, bytes } = await checkShareImage(c.url, c.source);
      if (bytes && check.width && check.height) {
        // Only display after the checks passed, from a blob: URL with the
        // declared type, never by pointing <img> at the remote URL.
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: check.contentType ?? 'image/*' }));
        blobsRef.current.push(url);
        blobs[c.url] = url;
      }
      checks.push(check);
    }
    patch(id, (s) => ({ images: skip.length ? [...s.images, ...checks] : checks, blobs: { ...s.blobs, ...blobs }, running: { ...s.running, images: false } }));
  }, [patch]);

  const run = useCallback(
    async (tab: TabInfo) => {
      if (!tab.url) return;
      const id = ++runId.current;
      revokeBlobs();
      const url = tab.url;
      setState({ ...EMPTY, url, tabId: tab.id, at: Date.now(), running: { raw: true, rendered: true, site: true } });

      const rawP = callBg({ type: 'raw', url })
        .then((raw) => {
          patch(id, (s) => ({ raw, running: { ...s.running, raw: false }, errors: { ...s.errors, raw: raw.fetch.error ?? undefined } }));
          return raw;
        })
        .catch((e) => {
          setRunning(id, 'raw', false, errMsg(e));
          return null;
        });

      const renderedP = (async () => {
        try {
          const page = await extractRendered(tab.id, url);
          const vitals = await getVitals(tab.id);
          patch(id, (s) => ({ rendered: { page, vitals, tabId: tab.id }, running: { ...s.running, rendered: false } }));
          return page;
        } catch (e) {
          setRunning(id, 'rendered', false, errMsg(e));
          return null;
        }
      })();

      const [raw, rendered] = await Promise.all([rawP, renderedP]);
      const finalUrl = raw && !raw.fetch.error ? raw.fetch.finalUrl : url;
      const canon = raw?.page ? canonical(raw.page) : rendered ? canonical(rendered) : null;
      const siteP = callBg({ type: 'site', url: finalUrl, canonical: canon && /^https?:/.test(canon) ? canon : null })
        .then((site) => patch(id, (s) => ({ site, running: { ...s.running, site: false } })))
        .catch((e) => setRunning(id, 'site', false, errMsg(e)));
      const imgP = raw ? checkImages(id, raw).catch((e) => setRunning(id, 'images', false, errMsg(e))) : Promise.resolve();
      await Promise.all([siteP, imgP]);
    },
    [patch, checkImages],
  );

  const refreshVitals = useCallback(async () => {
    const id = runId.current;
    const s = state;
    if (!s.tabId || !s.rendered) return;
    const vitals = await getVitals(s.tabId);
    patch(id, (st) => ({ rendered: st.rendered ? { ...st.rendered, vitals } : null }));
  }, [state, patch]);

  const probe = useCallback(
    async (kind: keyof Probes, linkMax = 150) => {
      const id = runId.current;
      const s = state;
      if (!s.url) return;
      const finalUrl = s.raw && !s.raw.fetch.error ? s.raw.fetch.finalUrl : s.url;
      setRunning(id, kind, true, '');
      try {
        if (kind === 'soft404') {
          const r = await callBg({ type: 'probe-soft404', url: finalUrl });
          patch(id, (st) => ({ probes: { ...st.probes, soft404: r } }));
        } else if (kind === 'canonical') {
          const c = (s.raw?.page && canonical(s.raw.page)) || (s.rendered && canonical(s.rendered.page));
          if (!c) throw new Error('No canonical link on the page');
          const r = await callBg({ type: 'probe-canonical', canonical: c });
          patch(id, (st) => ({ probes: { ...st.probes, canonical: r } }));
        } else if (kind === 'hreflang') {
          const r = await callBg({ type: 'probe-hreflang', url: finalUrl });
          patch(id, (st) => ({ probes: { ...st.probes, hreflang: r } }));
        } else if (kind === 'links') {
          const anchors = [...(s.rendered?.page.anchors ?? []), ...(s.raw?.page?.anchors ?? [])];
          const urls = [...new Set(anchors.filter((a) => a.kind === 'http' && a.href).map((a) => a.href!.split('#')[0]))];
          const r = await callBg({ type: 'probe-links', urls, max: linkMax });
          patch(id, (st) => ({ probes: { ...st.probes, links: r } }));
        }
        setRunning(id, kind, false);
      } catch (e) {
        setRunning(id, kind, false, errMsg(e));
      }
    },
    [state, patch],
  );

  const fetchAsBot = useCallback(
    async (botId: string) => {
      const id = runId.current;
      if (!state.url) return;
      setRunning(id, 'bot', true, '');
      try {
        const raw = await callBg({ type: 'raw', url: state.url, botId });
        patch(id, (s) => ({ bot: { botId, raw }, running: { ...s.running, bot: false } }));
      } catch (e) {
        setRunning(id, 'bot', false, errMsg(e));
      }
    },
    [state.url, patch],
  );

  const fetchShareBots = useCallback(async () => {
    const id = runId.current;
    if (!state.url) return;
    const url = state.raw && !state.raw.fetch.error ? state.raw.fetch.finalUrl : state.url;
    const botIds = [...new Set(PLATFORMS.map((p) => PLATFORM_BOT[p.platform]).filter(Boolean))];
    setRunning(id, 'shareBots', true, '');
    const results: Record<string, RawAudit> = {};
    try {
      // Sequential on purpose: the background serialises User-Agent overrides.
      for (const botId of botIds) {
        results[botId] = await callBg({ type: 'raw', url, botId });
        patch(id, (s) => ({ shareBots: { ...s.shareBots, [botId]: results[botId] } }));
      }
      setRunning(id, 'shareBots', false);
      if (state.raw) {
        const pages = Object.values(results).flatMap((r) => (r.page ? [r.page] : []));
        await checkImages(id, state.raw, pages, state.images.map((c) => c.url));
      }
    } catch (e) {
      setRunning(id, 'shareBots', false, errMsg(e));
    }
  }, [state.url, state.raw, state.images, patch, checkImages]);

  const recheckImage = useCallback(async () => {
    if (state.raw) await checkImages(runId.current, state.raw);
  }, [state.raw, checkImages]);

  useEffect(() => revokeBlobs, []);

  const report: AuditReport | null = useMemo(() => {
    if (!state.url || (!state.raw && !state.rendered)) return null;
    return audit({ url: state.url, raw: state.raw, rendered: state.rendered, site: state.site, probes: state.probes, images: state.images });
  }, [state.url, state.raw, state.rendered, state.site, state.probes, state.images]);

  const reset = useCallback(() => {
    runId.current++;
    revokeBlobs();
    setState(EMPTY);
  }, []);

  return { state, report, run, probe, fetchAsBot, fetchShareBots, refreshVitals, recheckImage, reset };
}

export async function canAudit(url: string | null): Promise<boolean> {
  if (!url || !/^https?:/i.test(url)) return false;
  return hasHostAccess(url);
}
