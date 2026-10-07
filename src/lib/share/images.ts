// Share-image (og:image / twitter:image) fetching and per-platform checks.
import { formatFromContentType, readImageHeader } from '../imageInfo';
import { fetchCapped, LIMITS } from '../net';
import type { ShareImageCheck } from '../types';
import type { PlatformRule } from './platforms';

export async function checkShareImage(
  url: string,
  source: string,
  fetcher: typeof fetchCapped = fetchCapped,
): Promise<{ check: ShareImageCheck; bytes: Uint8Array | null }> {
  let https = false;
  let host: string | null = null;
  try {
    const u = new URL(url);
    https = u.protocol === 'https:';
    host = u.hostname;
  } catch {
    /* invalid */
  }
  const base: ShareImageCheck = {
    url,
    source,
    https,
    status: 0,
    contentType: null,
    bytes: 0,
    format: 'unknown',
    width: null,
    height: null,
    host,
    error: null,
  };
  const { info, bytes } = await fetcher(url, { maxBytes: LIMITS.imageBytes, accept: 'image/*' });
  const check: ShareImageCheck = { ...base, status: info.status, contentType: info.contentType, bytes: info.bytes, error: info.error };
  if (info.truncated) check.error = `Image larger than ${LIMITS.imageBytes / 1024 / 1024} MB (not downloaded fully)`;
  if (!bytes || info.error) return { check, bytes: null };
  const header = readImageHeader(bytes);
  check.format = header.format !== 'unknown' ? header.format : (formatFromContentType(info.contentType) ?? 'unknown');
  check.width = header.width;
  check.height = header.height;
  const safe =
    !check.error &&
    info.ok &&
    /^image\//i.test(info.contentType ?? '') &&
    check.format !== 'svg' &&
    check.format !== 'unknown';
  return { check, bytes: safe ? bytes : null };
}

export interface ImageIssue {
  severity: 'error' | 'warning' | 'info';
  text: string;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Issues that apply to every platform (reachability, type). */
export function genericImageIssues(c: ShareImageCheck): ImageIssue[] {
  const out: ImageIssue[] = [];
  if (!c.https) out.push({ severity: 'warning', text: 'Image URL is not https' });
  if (c.error) out.push({ severity: 'error', text: `Could not load the image: ${c.error}` });
  else if (c.status !== 200) out.push({ severity: 'error', text: `Image returns HTTP ${c.status} without cookies` });
  else if (!/^image\//i.test(c.contentType ?? ''))
    out.push({ severity: 'error', text: `Content-Type is ${c.contentType ?? 'missing'}, not image/*` });
  return out;
}

export function platformImageIssues(c: ShareImageCheck, rule: PlatformRule, cardType?: string | null): ImageIssue[] {
  const out: ImageIssue[] = [];
  const r = rule.image;
  if (c.error || c.status !== 200) return out;
  if (r.unsupportedFormats.includes(c.format)) out.push({ severity: 'error', text: `${c.format.toUpperCase()} is not supported` });
  else if (r.formats.length && c.format !== 'unknown' && !r.formats.includes(c.format))
    out.push({ severity: 'warning', text: `${c.format.toUpperCase()} support is not documented (use JPEG or PNG)` });
  if (r.maxBytes && c.bytes > r.maxBytes) out.push({ severity: 'error', text: `${mb(c.bytes)} exceeds the ${mb(r.maxBytes)} limit` });
  if (c.width && c.height) {
    const small = rule.platform === 'x' && (cardType ?? rule.cardType?.default) === 'summary';
    const minW = small ? 144 : r.minWidth;
    const minH = small ? 144 : r.minHeight;
    if ((minW && c.width < minW) || (minH && c.height < minH))
      out.push({ severity: 'error', text: `${c.width}×${c.height} is below the ${minW ?? '?'}×${minH ?? '?'} minimum` });
    else if (!small && r.recommendedWidth && c.width < r.recommendedWidth)
      out.push({ severity: 'info', text: `${c.width}px wide, ${r.recommendedWidth}px recommended` });
    const ratio = small ? 1 : r.displayRatio;
    if (ratio) {
      const actual = c.width / c.height;
      if (Math.abs(actual - ratio) / ratio > 0.1)
        out.push({ severity: 'warning', text: `Ratio ${actual.toFixed(2)}:1 will be cropped to ${ratio}:1` });
    }
  }
  return out;
}
