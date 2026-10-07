// Text pixel-width estimate for Google result truncation. Google renders
// titles and snippets in Arial (or a metric-compatible font); widths below are
// Arial advance widths in 1/1000 em for ASCII 32..126. Deterministic so rules
// stay unit-testable (no canvas). Treat results as estimates.

// prettier-ignore
const ARIAL: number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // space ! " # $ % & ' ( ) * + , - . /
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556,                               // 0-9
  278, 278, 584, 584, 584, 556, 1015,                                             // : ; < = > ? @
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,                // A-M
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,                // N-Z
  278, 278, 278, 469, 556, 333,                                                   // [ \ ] ^ _ `
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833,                // a-m
  556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,                // n-z
  334, 260, 334, 584,                                                             // { | } ~
];

function charWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 32;
  if (code >= 32 && code <= 126) return ARIAL[code - 32];
  // Latin with diacritics: use the base letter
  const base = ch.normalize('NFD')[0];
  const baseCode = base.codePointAt(0) ?? 0;
  if (base !== ch && baseCode >= 32 && baseCode <= 126) return ARIAL[baseCode - 32];
  // CJK, kana, hangul, full-width forms: one em
  if (
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff)
  )
    return 1000;
  if (code === 0x2014) return 1000; // em dash
  if (code === 0x2013 || code === 0x2026) return 556; // en dash, ellipsis
  if (code === 0x2019 || code === 0x2018) return 222;
  if (code === 0x00b7 || code === 0x2022) return 350;
  return 556;
}

export function textWidthPx(text: string, fontSizePx: number): number {
  let units = 0;
  for (const ch of text) units += charWidth(ch);
  return Math.round((units * fontSizePx) / 1000);
}

/** Cuts text to fit `maxPx` and appends an ellipsis, like a search result. */
export function truncateToPx(text: string, fontSizePx: number, maxPx: number): { text: string; truncated: boolean } {
  if (textWidthPx(text, fontSizePx) <= maxPx) return { text, truncated: false };
  const ellipsis = textWidthPx(' ...', fontSizePx);
  let units = 0;
  let out = '';
  for (const ch of text) {
    const w = (charWidth(ch) * fontSizePx) / 1000;
    if (units + w + ellipsis > maxPx) break;
    units += w;
    out += ch;
  }
  // cut back to the previous word boundary when there is one nearby
  const sp = out.lastIndexOf(' ');
  if (sp > out.length * 0.7) out = out.slice(0, sp);
  return { text: out.trimEnd() + ' ...', truncated: true };
}

export function truncateChars(text: string, max: number | null | undefined): { text: string; truncated: boolean } {
  if (!max || [...text].length <= max) return { text, truncated: false };
  return { text: [...text].slice(0, Math.max(0, max - 1)).join('').trimEnd() + '…', truncated: true };
}

/** Google result typography (estimates; see src/rules/share/google.json). */
export const GOOGLE_TITLE_FONT_PX = 20;
export const GOOGLE_DESCRIPTION_FONT_PX = 14;
