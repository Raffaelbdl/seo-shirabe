// Image format and dimensions read from the file header. Pure (no decoding,
// no DOM), so it works in the service worker and in tests, and never hands
// untrusted bytes to an image decoder before the checks pass.
import type { ImageFormat } from './types';

export interface ImageHeader {
  format: ImageFormat;
  width: number | null;
  height: number | null;
}

const ascii = (b: Uint8Array, start: number, len: number) =>
  String.fromCharCode(...b.subarray(start, Math.min(b.length, start + len)));

export function readImageHeader(b: Uint8Array): ImageHeader {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const has = (n: number) => b.length >= n;
  // PNG
  if (has(24) && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') {
    return { format: 'png', width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  // GIF
  if (has(10) && ascii(b, 0, 3) === 'GIF') {
    return { format: 'gif', width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
  }
  // JPEG: walk segments to the first SOFn
  if (has(4) && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
        i += marker === 0xff ? 1 : 2;
        continue;
      }
      const len = dv.getUint16(i + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { format: 'jpeg', height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
      i += 2 + len;
    }
    return { format: 'jpeg', width: null, height: null };
  }
  // WebP
  if (has(30) && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const chunk = ascii(b, 12, 4);
    if (chunk === 'VP8 ') return { format: 'webp', width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = dv.getUint32(21, true);
      return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') {
      const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
      const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
      return { format: 'webp', width: w, height: h };
    }
    return { format: 'webp', width: null, height: null };
  }
  // AVIF / HEIF: ftyp box, dimensions in the first 'ispe' property
  if (has(16) && ascii(b, 4, 4) === 'ftyp' && /avif|avis|mif1/.test(ascii(b, 8, 16))) {
    const limit = Math.min(b.length - 20, 64 * 1024);
    for (let i = 0; i < limit; i++) {
      if (b[i] === 0x69 && ascii(b, i, 4) === 'ispe') {
        return { format: 'avif', width: dv.getUint32(i + 8), height: dv.getUint32(i + 12) };
      }
    }
    return { format: 'avif', width: null, height: null };
  }
  // BMP
  if (has(26) && ascii(b, 0, 2) === 'BM') {
    return { format: 'bmp', width: dv.getInt32(18, true), height: Math.abs(dv.getInt32(22, true)) };
  }
  // ICO
  if (has(8) && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) {
    return { format: 'ico', width: b[6] || 256, height: b[7] || 256 };
  }
  // SVG (text)
  const head = new TextDecoder('utf-8').decode(b.subarray(0, 4096));
  if (/<svg[\s>]/i.test(head)) {
    const tag = /<svg[^>]*>/i.exec(head)?.[0] ?? '';
    const num = (name: string) => {
      const m = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, 'i').exec(tag);
      return m ? Math.round(parseFloat(m[1])) : null;
    };
    let width = num('width');
    let height = num('height');
    if (width === null || height === null) {
      const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
      if (vb) {
        width = Math.round(parseFloat(vb[1]));
        height = Math.round(parseFloat(vb[2]));
      }
    }
    return { format: 'svg', width, height };
  }
  return { format: 'unknown', width: null, height: null };
}

export function formatFromContentType(ct: string | null): ImageFormat | null {
  if (!ct) return null;
  const m = /image\/([a-z0-9.+-]+)/i.exec(ct);
  if (!m) return null;
  const t = m[1].toLowerCase();
  if (t === 'jpeg' || t === 'jpg' || t === 'pjpeg') return 'jpeg';
  if (t === 'svg+xml') return 'svg';
  if (t === 'x-icon' || t === 'vnd.microsoft.icon') return 'ico';
  if (['png', 'gif', 'webp', 'avif', 'bmp'].includes(t)) return t as ImageFormat;
  return 'unknown';
}
