// Network layer shared by the background service worker and the side panel.
// Every request: no cookies, http(s) only, body size cap, timeout.
import type { FetchInfo, RedirectHop } from './types';

export const LIMITS = {
  htmlBytes: 15 * 1024 * 1024,
  imageBytes: 10 * 1024 * 1024,
  sitemapTotalBytes: 50 * 1024 * 1024,
  sitemapFileBytes: 20 * 1024 * 1024,
  robotsBytes: 512 * 1024,
  llmsBytes: 1024 * 1024,
  timeoutMs: 20_000,
} as const;

export interface FetchOptions {
  method?: 'GET' | 'HEAD';
  maxBytes?: number;
  timeoutMs?: number;
  accept?: string;
  /** Label of the User-Agent override active for this request (informational). */
  userAgent?: string | null;
  /** Returns the redirect hops observed for this request (webRequest), if any. */
  redirects?: (requestedUrl: string, startedAt: number) => RedirectHop[];
}

export interface FetchResult {
  info: FetchInfo;
  bytes: Uint8Array | null;
}

export function isFetchableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function errorInfo(url: string, error: string, started: number, userAgent: string | null): FetchInfo {
  return {
    requestedUrl: url,
    finalUrl: url,
    ok: false,
    status: 0,
    statusText: '',
    headers: [],
    contentType: null,
    bytes: 0,
    truncated: false,
    redirects: [],
    timingMs: Math.round(performance.now() - started),
    userAgent,
    error,
  };
}

async function readCapped(res: Response, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - total));
      total = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return { bytes: out, truncated };
}

export async function fetchCapped(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const started = performance.now();
  const startedAt = Date.now();
  const ua = opts.userAgent ?? null;
  if (!isFetchableUrl(url)) return { info: errorInfo(url, 'Only http(s) URLs are fetched', started, ua), bytes: null };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? LIMITS.timeoutMs);
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: ctrl.signal,
      headers: opts.accept ? { Accept: opts.accept } : undefined,
    });
    if (!isFetchableUrl(res.url || url)) {
      return { info: errorInfo(url, 'Redirected to a non-http(s) URL', started, ua), bytes: null };
    }
    let body: { bytes: Uint8Array; truncated: boolean } = { bytes: new Uint8Array(0), truncated: false };
    if ((opts.method ?? 'GET') === 'GET') body = await readCapped(res, opts.maxBytes ?? LIMITS.htmlBytes);
    const headers: [string, string][] = [];
    res.headers.forEach((v, k) => headers.push([k, v]));
    let redirects = opts.redirects ? opts.redirects(url, startedAt) : [];
    if (res.redirected && redirects.length === 0) {
      // webRequest could not observe the hops (no host permission on an
      // intermediate origin): at least record that a redirect happened.
      redirects = [{ url, status: 0, location: res.url }];
    }
    return {
      info: {
        requestedUrl: url,
        finalUrl: res.url || url,
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        headers,
        contentType: res.headers.get('content-type'),
        bytes: body.bytes.byteLength,
        truncated: body.truncated,
        redirects,
        timingMs: Math.round(performance.now() - started),
        userAgent: ua,
        error: null,
      },
      bytes: body.bytes,
    };
  } catch (e) {
    const msg = ctrl.signal.aborted ? 'Timed out' : e instanceof Error ? e.message : String(e);
    return {
      info: errorInfo(url, /Failed to fetch/i.test(msg) ? 'Network error or blocked by CORS (is host access granted?)' : msg, started, ua),
      bytes: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Charset from Content-Type, else from a <meta charset> in the first 2 KB, else UTF-8. */
export function sniffCharset(contentType: string | null, bytes: Uint8Array): string {
  const fromHeader = contentType && /charset=["']?([^;"'\s]+)/i.exec(contentType);
  if (fromHeader) return fromHeader[1];
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  const m = /<meta[^>]+charset=["']?([a-z0-9_-]+)/i.exec(head);
  return m ? m[1] : 'utf-8';
}

export function decodeText(contentType: string | null, bytes: Uint8Array): string {
  const charset = sniffCharset(contentType, bytes);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export function isHtmlContentType(ct: string | null): boolean {
  if (!ct) return true; // sniff later; many servers omit it
  return /text\/html|application\/xhtml\+xml/i.test(ct);
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Runs `fn` over `items` with at most `concurrency` in flight. */
export async function mapLimit<T, R>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Spaces out requests to the same origin by at least `gapMs`. */
export function politeGate(gapMs: number) {
  const last = new Map<string, number>();
  return async (url: string) => {
    let origin = '';
    try {
      origin = new URL(url).origin;
    } catch {
      return;
    }
    const now = Date.now();
    const at = Math.max(now, (last.get(origin) ?? 0) + gapMs);
    last.set(origin, at);
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  };
}
