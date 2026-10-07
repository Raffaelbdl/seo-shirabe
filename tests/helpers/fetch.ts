import type { FetchInfo } from '../../src/lib/types';

export function fetchInfo(url: string, html: string, extra: Partial<FetchInfo> = {}): FetchInfo {
  return {
    requestedUrl: url,
    finalUrl: url,
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: [['content-type', 'text/html; charset=utf-8']],
    contentType: 'text/html; charset=utf-8',
    bytes: new TextEncoder().encode(html).length,
    truncated: false,
    redirects: [],
    timingMs: 10,
    userAgent: null,
    error: null,
    ...extra,
  };
}
