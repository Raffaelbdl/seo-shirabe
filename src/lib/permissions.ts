// Host-permission helpers. Host access is optional and requested per origin
// (or once for all sites from Settings).

export const ALL_SITES = ['<all_urls>'];

/** Minimal match-pattern test (scheme://host/path with * wildcards). */
export function matchesPattern(pattern: string, url: string): boolean {
  if (pattern === '<all_urls>') return /^(https?|file|ftp):/i.test(url);
  const m = /^(\*|https?|file|ftp):\/\/([^/]*)(\/.*)$/.exec(pattern);
  if (!m) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const [, scheme, host, path] = m;
  const proto = u.protocol.slice(0, -1);
  if (scheme === '*' ? proto !== 'http' && proto !== 'https' : scheme !== proto) return false;
  if (host !== '*') {
    if (host.startsWith('*.')) {
      const base = host.slice(2);
      if (u.hostname !== base && !u.hostname.endsWith('.' + base)) return false;
    } else if (host.replace(/:\d+$/, '') !== u.hostname) return false;
  }
  const re = new RegExp('^' + path.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(u.pathname + u.search);
}

export function originPatternFor(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

export async function grantedOrigins(): Promise<string[]> {
  const all = await chrome.permissions.getAll();
  return all.origins ?? [];
}

export async function hasHostAccess(url: string): Promise<boolean> {
  const origins = await grantedOrigins();
  return origins.some((p) => matchesPattern(p, url));
}

/** Must be called from a user gesture (button click) in an extension page. */
export async function requestHostAccess(urls: string[]): Promise<boolean> {
  const origins = [...new Set(urls.map(originPatternFor).filter((x): x is string => !!x))];
  if (!origins.length) return false;
  return chrome.permissions.request({ origins });
}
