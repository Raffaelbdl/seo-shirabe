// URL helpers used by rules. Pure functions, unit-tested.

export function safeUrl(u: string | null | undefined, base?: string): URL | null {
  if (!u) return null;
  try {
    return base ? new URL(u, base) : new URL(u);
  } catch {
    return null;
  }
}

export function isHttpUrl(u: string | null | undefined): boolean {
  const p = safeUrl(u);
  return !!p && (p.protocol === 'http:' || p.protocol === 'https:');
}

export function isAbsoluteHttp(raw: string): boolean {
  return /^https?:\/\//i.test(raw.trim());
}

/** Fully decodes percent-escapes where possible (for "same page?" comparisons). */
export function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Drops the fragment; keeps everything else as-is. */
export function stripHash(u: string): string {
  const i = u.indexOf('#');
  return i === -1 ? u : u.slice(0, i);
}

export type UrlDiff = 'identical' | 'encoding' | 'trailing-slash' | 'case' | 'www' | 'protocol' | 'different';

/**
 * Compares two absolute URLs and says how they differ, when the difference
 * is only cosmetic (encoding, trailing slash, case, www, protocol).
 */
export function compareUrls(a: string, b: string): UrlDiff {
  const ua = safeUrl(stripHash(a));
  const ub = safeUrl(stripHash(b));
  if (!ua || !ub) return a === b ? 'identical' : 'different';
  if (ua.href === ub.href) return 'identical';
  const sameExceptPath = ua.protocol === ub.protocol && ua.host === ub.host && ua.search === ub.search;
  if (sameExceptPath) {
    if (decodeSafe(ua.pathname) === decodeSafe(ub.pathname)) return 'encoding';
    const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);
    if (trim(ua.pathname) === trim(ub.pathname)) return 'trailing-slash';
    if (decodeSafe(ua.pathname).toLowerCase() === decodeSafe(ub.pathname).toLowerCase()) return 'case';
  }
  if (ua.protocol === ub.protocol && ua.pathname === ub.pathname && ua.search === ub.search) {
    if (ua.hostname.replace(/^www\./, '') === ub.hostname.replace(/^www\./, '')) return 'www';
  }
  if (ua.protocol !== ub.protocol && ua.host === ub.host && ua.pathname === ub.pathname && ua.search === ub.search) {
    return 'protocol';
  }
  return 'different';
}

/** True when the URLs point to the same page, ignoring encoding, fragment and a trailing slash. */
export function samePage(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const d = compareUrls(a, b);
  return d === 'identical' || d === 'encoding' || d === 'trailing-slash';
}

// A small subset of multi-label public suffixes, enough for "is this the same
// site?" decisions without shipping the full Public Suffix List.
const MULTI_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'com.au', 'net.au', 'org.au',
  'co.nz', 'com.br', 'com.cn', 'net.cn', 'org.cn', 'com.tw', 'com.hk', 'co.kr', 'or.kr', 'com.mx', 'com.ar',
  'co.in', 'co.za', 'com.sg', 'com.tr', 'co.id', 'com.my', 'com.ph', 'com.vn', 'co.th', 'github.io', 'pages.dev',
  'vercel.app', 'netlify.app', 'web.app', 'firebaseapp.com', 'herokuapp.com', 'cloudfront.net', 'appspot.com',
  'blogspot.com', 'workers.dev',
]);

export function registrableDomain(host: string | null | undefined): string | null {
  if (!host) return null;
  const h = host.toLowerCase().replace(/\.$/, '');
  if (/^[\d.]+$/.test(h) || h.includes(':')) return h;
  const labels = h.split('.');
  if (labels.length <= 2) return h;
  const last2 = labels.slice(-2).join('.');
  if (MULTI_SUFFIXES.has(last2)) return labels.slice(-3).join('.');
  return last2;
}

export function hostOf(u: string | null | undefined): string | null {
  return safeUrl(u)?.hostname ?? null;
}

export function sameSite(a: string | null | undefined, b: string | null | undefined): boolean {
  const ra = registrableDomain(hostOf(a));
  const rb = registrableDomain(hostOf(b));
  return !!ra && ra === rb;
}

export function originOf(u: string): string | null {
  const p = safeUrl(u);
  return p && (p.protocol === 'http:' || p.protocol === 'https:') ? p.origin : null;
}

/** Number of non-empty path segments. */
export function pathDepth(u: string): number {
  const p = safeUrl(u);
  if (!p) return 0;
  return p.pathname.split('/').filter(Boolean).length;
}

/** "/" or a single short language-like segment such as "/fr/" or "/en-us". */
export function isHomeLike(u: string): boolean {
  const p = safeUrl(u);
  if (!p) return false;
  const segs = p.pathname.split('/').filter(Boolean);
  if (segs.length === 0) return true;
  return segs.length === 1 && /^[a-z]{2,3}([-_][a-z0-9]{2,4})?$/i.test(segs[0]) && !p.search;
}

export function isHomepage(u: string): boolean {
  const p = safeUrl(u);
  return !!p && (p.pathname === '/' || p.pathname === '') && !p.search;
}

/** Replaces the last path segment with a random one (soft-404 probe). */
export function soft404ProbeUrl(u: string, rand = Math.random().toString(36).slice(2, 8)): string {
  const p = new URL(u);
  p.hash = '';
  p.search = '';
  const segs = p.pathname.split('/');
  const trailing = p.pathname.endsWith('/') && segs.length > 2;
  if (trailing) segs.pop();
  const name = `zz-shirabe-404-test-${rand}`;
  if (segs.length <= 1 || (segs.length === 2 && segs[1] === '')) p.pathname = '/' + name;
  else {
    segs[segs.length - 1] = name;
    p.pathname = segs.join('/');
  }
  return p.href;
}

export function originPattern(u: string): string | null {
  const o = originOf(u);
  return o ? `${o}/*` : null;
}
