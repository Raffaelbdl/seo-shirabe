import type { PageData, PageView } from '../types';

export interface ExtractArgs {
  /** Raw HTML to parse with DOMParser; null (or absent) = use the live `document`. */
  html: string | null;
  url: string;
  view: PageView;
}

/**
 * Extracts every SEO signal from a document.
 *
 * IMPORTANT: this function must stay fully self-contained (no references to
 * imports or module-level values, only types). It is serialised and injected
 * with `chrome.scripting.executeScript({ func })` for the rendered DOM and with
 * Playwright's `page.evaluate` in tests. Raw HTML is parsed with DOMParser in
 * the offscreen document. Both views therefore run exactly the same code.
 */
export function extractPage(args: ExtractArgs): PageData {
  const MAX_ANCHORS = 5000;
  const MAX_IMAGES = 3000;
  const MAX_TEXT = 500_000;
  const MAX_BLOCKS = 3000;
  const MAX_CLICKABLES = 300;
  const MAX_SCAN_ELEMENTS = 25_000;

  // typeof check, not `!== null`: chrome.scripting.executeScript drops null
  // properties from args, so the rendered call arrives with html undefined.
  const isRendered = typeof args.html !== 'string';
  const doc: Document = isRendered ? document : new DOMParser().parseFromString(args.html as string, 'text/html');
  const pageUrl = args.url;
  const encoder = new TextEncoder();
  const byteLength = (s: string) => encoder.encode(s).length;
  const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();

  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    base = new URL('about:blank');
  }
  const baseEl = doc.querySelector('base[href]');
  if (baseEl) {
    try {
      base = new URL(baseEl.getAttribute('href') || '', base);
    } catch {
      /* keep page URL */
    }
  }
  const resolve = (href: string | null | undefined): string | null => {
    if (href === null || href === undefined) return null;
    try {
      return new URL(href.trim(), base).href;
    } catch {
      return null;
    }
  };
  const pageHost = (() => {
    try {
      return new URL(pageUrl).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();
  const hostOf = (u: string | null): string | null => {
    if (!u) return null;
    try {
      return new URL(u).hostname;
    } catch {
      return null;
    }
  };
  const isInternalHost = (h: string | null) => !!h && h.replace(/^www\./, '') === pageHost;

  const escapeCss = (s: string) =>
    typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
  const selectorOf = (el: Element): string => {
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur.nodeType === 1 && parts.length < 12) {
      const tag = cur.tagName.toLowerCase();
      if (tag === 'html') {
        parts.unshift('html');
        break;
      }
      const id = cur.getAttribute('id');
      if (id && doc.querySelectorAll('#' + escapeCss(id)).length === 1) {
        parts.unshift('#' + escapeCss(id));
        break;
      }
      let index = 1;
      let sib = cur.previousElementSibling;
      while (sib) {
        if (sib.tagName === cur.tagName) index++;
        sib = sib.previousElementSibling;
      }
      parts.unshift(tag + ':nth-of-type(' + index + ')');
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  };
  const inHead = (el: Element) => !!doc.head && doc.head.contains(el);

  // ---- head ---------------------------------------------------------------
  const titles = Array.from(doc.querySelectorAll('title'))
    .filter((t) => !t.closest('svg'))
    .map((t) => ({ text: norm(t.textContent), inHead: inHead(t) }));

  const metas = Array.from(doc.querySelectorAll('meta')).map((m) => ({
    name: m.getAttribute('name'),
    property: m.getAttribute('property'),
    httpEquiv: m.getAttribute('http-equiv'),
    charset: m.getAttribute('charset'),
    itemprop: m.getAttribute('itemprop'),
    content: m.getAttribute('content'),
    inHead: inHead(m),
  }));

  const headLinks = Array.from(doc.querySelectorAll('link[rel]'))
    .filter((l) => !l.closest('svg'))
    .map((l) => ({
      rel: (l.getAttribute('rel') || '').toLowerCase().trim(),
      href: resolve(l.getAttribute('href')),
      rawHref: l.getAttribute('href') || '',
      hreflang: l.getAttribute('hreflang'),
      type: l.getAttribute('type'),
      sizes: l.getAttribute('sizes'),
      media: l.getAttribute('media'),
      inHead: inHead(l),
    }));

  let charset: string | null = null;
  for (const m of metas) {
    if (m.charset) {
      charset = m.charset;
      break;
    }
    if (m.httpEquiv && m.httpEquiv.toLowerCase() === 'content-type' && m.content) {
      const match = /charset=([^;\s]+)/i.exec(m.content);
      if (match) {
        charset = match[1];
        break;
      }
    }
  }

  // ---- structured data -----------------------------------------------------
  const collectTypes = (node: unknown, out: Set<string>, depth: number) => {
    if (depth > 12 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) collectTypes(n, out, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    const t = obj['@type'];
    if (typeof t === 'string') out.add(t);
    else if (Array.isArray(t)) for (const x of t) if (typeof x === 'string') out.add(x);
    for (const key of Object.keys(obj)) {
      if (key === '@context') continue;
      collectTypes(obj[key], out, depth + 1);
    }
  };
  const jsonLd = Array.from(doc.querySelectorAll('script')).filter(
    (s) => (s.getAttribute('type') || '').trim().toLowerCase() === 'application/ld+json',
  ).map((s) => {
    const raw = s.textContent || '';
    let parsed: unknown = null;
    let error: string | null = null;
    const types = new Set<string>();
    try {
      parsed = JSON.parse(raw);
      collectTypes(parsed, types, 0);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    return { raw: raw.length > 200_000 ? raw.slice(0, 200_000) : raw, parsed, error, types: Array.from(types), selector: selectorOf(s) };
  });

  const microdataTypes = Array.from(doc.querySelectorAll('[itemscope][itemtype]'))
    .filter((el) => !el.parentElement || !el.parentElement.closest('[itemscope]'))
    .map((el) => (el.getAttribute('itemtype') || '').trim())
    .filter(Boolean);
  const rdfaTypes = Array.from(doc.querySelectorAll('[typeof]'))
    .map((el) => (el.getAttribute('typeof') || '').trim())
    .filter(Boolean);

  // ---- headings ------------------------------------------------------------
  const headingText = (el: Element) => {
    let t = norm(el.textContent);
    if (!t) {
      const alts = Array.from(el.querySelectorAll('img[alt]')).map((i) => i.getAttribute('alt') || '');
      t = norm(alts.join(' '));
    }
    return t;
  };
  const headings = Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    .slice(0, 2000)
    .map((h) => ({ level: Number(h.tagName[1]), text: headingText(h).slice(0, 300), selector: selectorOf(h) }));

  // ---- links ---------------------------------------------------------------
  const allAnchors = Array.from(doc.querySelectorAll('a[href], area[href]'));
  const anchors = allAnchors.slice(0, MAX_ANCHORS).map((a) => {
    const rawHref = a.getAttribute('href') || '';
    const trimmed = rawHref.trim();
    const lower = trimmed.toLowerCase();
    let kind: PageData['anchors'][number]['kind'] = 'other';
    let href: string | null = null;
    if (trimmed === '') kind = 'empty';
    else if (lower.startsWith('javascript:')) kind = 'js';
    else if (lower.startsWith('mailto:')) kind = 'mailto';
    else if (lower.startsWith('tel:')) kind = 'tel';
    else if (trimmed.startsWith('#')) kind = 'hash';
    else {
      href = resolve(trimmed);
      if (href && /^https?:/i.test(href)) kind = 'http';
    }
    let text = norm(a.textContent);
    if (!text) text = norm(a.getAttribute('aria-label'));
    if (!text) text = norm(a.getAttribute('title'));
    if (!text) {
      const img = a.querySelector('img[alt]');
      if (img) text = norm(img.getAttribute('alt'));
    }
    return {
      href,
      rawHref,
      text: text.slice(0, 200),
      rel: (a.getAttribute('rel') || '').toLowerCase(),
      kind,
      internal: kind === 'http' && isInternalHost(hostOf(href)),
      selector: selectorOf(a),
    };
  });

  // ---- images --------------------------------------------------------------
  const viewportH = isRendered ? window.innerHeight : 0;
  const scrollY = isRendered ? window.scrollY : 0;
  const allImgs = Array.from(doc.querySelectorAll('img'));
  const placeholder = /^data:|blank|spacer|placeholder|transparent|1x1|pixel\.gif/i;
  const images = allImgs.slice(0, MAX_IMAGES).map((img) => {
    const rawSrc = img.getAttribute('src') || '';
    let src: string | null = null;
    if (isRendered) src = (img as HTMLImageElement).currentSrc || resolve(rawSrc);
    else src = rawSrc ? resolve(rawSrc) : null;
    const lazyAttr =
      img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original') || null;
    const lazySrc = lazyAttr && (!rawSrc || placeholder.test(rawSrc)) ? lazyAttr : null;
    const role = (img.getAttribute('role') || '').toLowerCase();
    const alt = img.getAttribute('alt');
    const info: PageData['images'][number] = {
      src,
      rawSrc,
      lazySrc,
      alt,
      decorative:
        role === 'presentation' || role === 'none' || img.getAttribute('aria-hidden') === 'true' || alt === '',
      widthAttr: img.getAttribute('width'),
      heightAttr: img.getAttribute('height'),
      loading: img.getAttribute('loading'),
      srcset: img.getAttribute('srcset'),
      host: hostOf(src && /^https?:/i.test(src) ? src : null),
      selector: selectorOf(img),
    };
    if (isRendered) {
      const el = img as HTMLImageElement;
      const rect = el.getBoundingClientRect();
      info.natural = { w: el.naturalWidth, h: el.naturalHeight };
      info.displayed = { w: Math.round(rect.width), h: Math.round(rect.height) };
      info.belowFold = rect.top + scrollY > viewportH;
    }
    return info;
  });

  // ---- text ----------------------------------------------------------------
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'OBJECT', 'CANVAS', 'HEAD']);
  const BLOCK = new Set([
    'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD', 'TH', 'DT', 'DD', 'BLOCKQUOTE', 'FIGCAPTION', 'PRE',
    'LABEL', 'BUTTON', 'A', 'SUMMARY', 'CAPTION', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'NAV', 'MAIN',
    'ASIDE', 'FORM', 'TABLE', 'UL', 'OL', 'DL', 'FIGURE', 'SPAN', 'OPTION',
  ]);
  const textParts: string[] = [];
  const blockMap = new Map<Element, string[]>();
  let textLen = 0;
  let textTruncated = false;
  const body = doc.body;
  if (body) {
    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        let p = node.parentElement;
        while (p && p !== body) {
          if (SKIP.has(p.tagName.toUpperCase())) return NodeFilter.FILTER_REJECT;
          p = p.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const t = norm(n.nodeValue);
      if (!t) continue;
      if (textLen + t.length > MAX_TEXT) {
        textTruncated = true;
        break;
      }
      textParts.push(t);
      textLen += t.length + 1;
      let blockEl = n.parentElement;
      while (blockEl && blockEl !== body && !BLOCK.has(blockEl.tagName.toUpperCase())) blockEl = blockEl.parentElement;
      const key = blockEl || body;
      const arr = blockMap.get(key);
      if (arr) arr.push(t);
      else blockMap.set(key, [t]);
    }
  }
  const text = textParts.join(' ');
  const blockSet = new Set<string>();
  for (const parts of blockMap.values()) {
    if (blockSet.size >= MAX_BLOCKS) break;
    const b = parts.join(' ').slice(0, 300);
    if (b.length >= 2) blockSet.add(b);
  }
  let wordCount = 0;
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: object) => { segment(s: string): Iterable<{ isWordLike?: boolean }> } }).Segmenter;
  if (Seg) {
    const seg = new Seg('und', { granularity: 'word' });
    for (const s of seg.segment(text)) if (s.isWordLike) wordCount++;
  } else {
    wordCount = text.split(/\s+/).filter(Boolean).length;
  }

  // ---- weight & framework payloads -----------------------------------------
  const scripts = Array.from(doc.querySelectorAll('script'));
  let inlineScriptBytes = 0;
  let rscBytes = 0;
  const framework: PageData['framework'] = [];
  const addPayload = (kind: PageData['framework'][number]['kind'], bytes: number) => {
    if (bytes <= 0) return;
    const existing = framework.find((f) => f.kind === kind);
    if (existing) existing.bytes += bytes;
    else framework.push({ kind, bytes });
  };
  for (const s of scripts) {
    if (s.hasAttribute('src')) continue;
    const content = s.textContent || '';
    const bytes = byteLength(content);
    inlineScriptBytes += bytes;
    const id = (s.getAttribute('id') || '').toLowerCase();
    const type = (s.getAttribute('type') || '').toLowerCase();
    if (id === 'ng-state' || (id.endsWith('-state') && type === 'application/json')) addPayload('angular-ng-state', bytes);
    else if (id === '__next_data__') addPayload('next-data', bytes);
    else if (id === '__nuxt_data__' || /window\.__NUXT__\s*=/.test(content.slice(0, 200))) addPayload('nuxt', bytes);
    else if (s.hasAttribute('data-sveltekit-fetched')) addPayload('sveltekit', bytes);
    else if (content.includes('self.__next_f')) rscBytes += bytes;
    else if (/window\.__remixContext\s*=/.test(content.slice(0, 300))) addPayload('remix', bytes);
    else if (/__APOLLO_STATE__\s*=/.test(content.slice(0, 300))) addPayload('apollo', bytes);
    else if (/window\.__(INITIAL|PRELOADED)_STATE__\s*=/.test(content.slice(0, 300))) addPayload('redux-initial-state', bytes);
  }
  addPayload('next-rsc', rscBytes);

  let inlineStyleBytes = 0;
  let fontFaceCount = 0;
  let dataUriCount = 0;
  let dataUriBytes = 0;
  const dataUriRe = /url\(\s*(['"]?)(data:[^'")]*)\1\s*\)/gi;
  const styles = Array.from(doc.querySelectorAll('style'));
  for (const st of styles) {
    const css = st.textContent || '';
    inlineStyleBytes += byteLength(css);
    const ff = css.match(/@font-face/gi);
    if (ff) fontFaceCount += ff.length;
    let m: RegExpExecArray | null;
    dataUriRe.lastIndex = 0;
    while ((m = dataUriRe.exec(css))) {
      dataUriCount++;
      dataUriBytes += m[2].length;
    }
  }
  for (const img of allImgs) {
    const s = img.getAttribute('src') || '';
    if (s.startsWith('data:')) {
      dataUriCount++;
      dataUriBytes += s.length;
    }
  }

  // ---- non-crawlable link candidates (rendered only) -----------------------
  const clickables: PageData['clickables'] = [];
  if (isRendered && body) {
    const NATIVE = 'a[href], button, input, select, textarea, label, summary, option, [contenteditable="true"]';
    const CONTENTISH = /card|item|tile|entry|result|post|anime|title|row|cell|link|teaser|thumb|list/i;
    const seen = new Set<Element>();
    const all = body.getElementsByTagName('*');
    const limit = Math.min(all.length, MAX_SCAN_ELEMENTS);
    for (let i = 0; i < limit && clickables.length < MAX_CLICKABLES; i++) {
      const el = all[i];
      if (seen.has(el)) continue;
      const tag = el.tagName.toLowerCase();
      if (tag === 'svg' || el.closest('svg')) continue;
      if (el.matches(NATIVE) || el.closest('a[href], button')) continue;
      if (el.querySelector('a[href]')) continue; // container already holding a real link
      const reasons: string[] = [];
      const role = (el.getAttribute('role') || '').toLowerCase();
      if (role === 'link') reasons.push('role="link"');
      if (role === 'button') reasons.push('role="button"');
      if (el.hasAttribute('onclick')) reasons.push('onclick attribute');
      let pointer = false;
      if (!reasons.length || role !== 'link') {
        const cs = getComputedStyle(el);
        const parentCs = el.parentElement ? getComputedStyle(el.parentElement) : null;
        // only report the outermost pointer element (cursor is inherited)
        pointer = cs.cursor === 'pointer' && (!parentCs || parentCs.cursor !== 'pointer');
        if (pointer) reasons.push('cursor: pointer');
      }
      if (!reasons.length) continue;
      const t = norm((el as HTMLElement).innerText || el.textContent).slice(0, 160);
      if (t.length < 2) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 12) continue;
      const cls = typeof el.className === 'string' ? el.className : '';
      const looksLikeContent =
        role === 'link' ||
        tag === 'li' ||
        tag === 'article' ||
        tag === 'tr' ||
        CONTENTISH.test(cls) ||
        !!el.querySelector('img, h1, h2, h3, h4, h5, h6');
      if (!looksLikeContent) continue;
      // controls with very short labels (e.g. "Close", "Menu") are UI, not navigation
      if (role === 'button' && t.split(' ').length < 2 && !el.querySelector('img')) continue;
      for (const d of Array.from(el.getElementsByTagName('*'))) seen.add(d);
      clickables.push({
        selector: selectorOf(el),
        tag,
        text: t,
        reasons,
        group: tag + (cls ? '.' + cls.trim().split(/\s+/).slice(0, 3).join('.') : ''),
      });
    }
  }

  // ---- resource timing (rendered only) --------------------------------------
  let resources: PageData['resources'];
  if (isRendered && typeof performance !== 'undefined' && performance.getEntriesByType) {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const byType: Record<string, { count: number; transferBytes: number }> = {};
    let transferBytes = 0;
    for (const e of entries) {
      const type = e.initiatorType || 'other';
      const b = e.transferSize || 0;
      transferBytes += b;
      const slot = byType[type] || (byType[type] = { count: 0, transferBytes: 0 });
      slot.count++;
      slot.transferBytes += b;
    }
    resources = { count: entries.length, transferBytes, byType };
  }

  const hasBreadcrumbNav = !!doc.querySelector(
    '[aria-label*="breadcrumb" i], [class*="breadcrumb" i], [id*="breadcrumb" i], nav ol[itemtype*="BreadcrumbList"]',
  );

  return {
    url: pageUrl,
    view: args.view,
    lang: doc.documentElement ? doc.documentElement.getAttribute('lang') : null,
    charset,
    titles,
    metas,
    headLinks,
    headings,
    anchors,
    images,
    jsonLd,
    microdataTypes,
    rdfaTypes,
    text,
    wordCount,
    textBlocks: Array.from(blockSet),
    framework,
    inlineStyleBytes,
    inlineStyleCount: styles.length,
    fontFaceCount,
    dataUriCount,
    dataUriBytes,
    inlineScriptBytes,
    scriptCount: scripts.length,
    stylesheetCount: headLinks.filter((l) => l.rel.split(/\s+/).includes('stylesheet')).length,
    bodyElementCount: body ? body.getElementsByTagName('*').length : 0,
    hasBreadcrumbNav,
    clickables,
    resources,
    truncated: { anchors: allAnchors.length > MAX_ANCHORS, images: allImgs.length > MAX_IMAGES, text: textTruncated },
  };
}
