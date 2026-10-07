// Heuristic page-type guess, used to suggest the structured data a page
// should carry. Deliberately simple and explained in the finding.
import { socialMeta } from './page';
import type { PageData } from './types';
import { isHomeLike, safeUrl } from './url';

export type PageType = 'home' | 'article' | 'event' | 'event-list' | 'place' | 'listing' | 'other';

export const EXPECTED_SCHEMA: Record<PageType, string[]> = {
  home: ['WebSite', 'Organization'],
  article: ['Article', 'NewsArticle', 'BlogPosting'],
  event: ['Event'],
  'event-list': ['ItemList', 'Event'],
  place: ['Place', 'TouristAttraction', 'LandmarksOrHistoricalBuildings', 'ItemList', 'Map', 'CreativeWork', 'TVSeries', 'Movie'],
  listing: ['ItemList', 'CollectionPage'],
  other: [],
};

export function guessPageType(url: string, page: PageData | null): { type: PageType; reason: string } {
  if (isHomeLike(url)) return { type: 'home', reason: 'URL is the site root or a language root' };
  const u = safeUrl(url);
  const segs = (u?.pathname ?? '').toLowerCase().split('/').filter(Boolean);
  const last = segs[segs.length - 1] ?? '';
  const ogType = page ? (socialMeta(page, 'og:type')?.value ?? '').toLowerCase() : '';
  if (ogType === 'article') return { type: 'article', reason: 'og:type is "article"' };
  if (segs.some((s) => /^(blog|news|articles?|posts?|stories|magazine)$/.test(s)) && segs.length >= 2 && !/^(blog|news|articles?|posts?)$/.test(last))
    return { type: 'article', reason: 'URL is under a blog/news section' };
  if (/^(events?|agenda|calendar)$/.test(last)) return { type: 'event-list', reason: 'URL ends with an events section' };
  if (segs.some((s) => /^(events?|agenda)$/.test(s))) return { type: 'event', reason: 'URL is inside an events section' };
  if (segs.some((s) => /^(maps?|places?|spots?|locations?|anime|pilgrimage)$/.test(s)) && segs.length >= 2 && !/^(maps?|places?|spots?)$/.test(last))
    return { type: 'place', reason: 'URL is a map / place / anime detail page' };
  if (/^(maps?|places?|spots?|list|catalog|search|anime)$/.test(last)) return { type: 'listing', reason: 'URL ends with a listing section' };
  return { type: 'other', reason: 'no strong signal' };
}
