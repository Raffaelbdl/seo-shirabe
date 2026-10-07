// Sitemap parsing. Sitemaps are machine-generated XML with a tiny vocabulary,
// so a tolerant tag scanner is enough and works in the service worker (which
// has no DOMParser). https://www.sitemaps.org/protocol.html

export interface SitemapEntry {
  loc: string;
  alternates: { hreflang: string; href: string }[];
}

export interface ParsedSitemap {
  kind: 'urlset' | 'sitemapindex' | 'unknown';
  urls: SitemapEntry[];
  sitemaps: string[];
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&')
    .trim();
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? decodeXml(m[2] ?? m[3] ?? '') : null;
}

export function parseSitemap(xml: string): ParsedSitemap {
  const head = xml.slice(0, 4000);
  const kind: ParsedSitemap['kind'] = /<(\w+:)?sitemapindex[\s>]/i.test(head)
    ? 'sitemapindex'
    : /<(\w+:)?urlset[\s>]/i.test(head)
      ? 'urlset'
      : 'unknown';
  const urls: SitemapEntry[] = [];
  const sitemaps: string[] = [];
  const blockRe = kind === 'sitemapindex' ? /<(?:\w+:)?sitemap[\s>][\s\S]*?<\/(?:\w+:)?sitemap>/gi : /<(?:\w+:)?url[\s>][\s\S]*?<\/(?:\w+:)?url>/gi;
  const locRe = /<(?:\w+:)?loc>([\s\S]*?)<\/(?:\w+:)?loc>/i;
  const linkRe = /<(?:xhtml:)?link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml))) {
    const block = m[0];
    const loc = locRe.exec(block);
    if (!loc) continue;
    const value = decodeXml(loc[1]);
    if (kind === 'sitemapindex') {
      sitemaps.push(value);
      continue;
    }
    const alternates: SitemapEntry['alternates'] = [];
    let l: RegExpExecArray | null;
    linkRe.lastIndex = 0;
    while ((l = linkRe.exec(block))) {
      const rel = attr(l[0], 'rel');
      const hreflang = attr(l[0], 'hreflang');
      const href = attr(l[0], 'href');
      if (rel === 'alternate' && hreflang && href) alternates.push({ hreflang, href });
    }
    urls.push({ loc: value, alternates });
  }
  return { kind, urls, sitemaps };
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}
