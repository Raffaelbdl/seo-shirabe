# Rule catalogue

_Generated from `src/lib/rules/` by `tests/unit/rules-doc.test.ts` — do not edit by hand._

Each rule is a pure function over the collected data. `view` is the data it reads: `raw` (server HTML), `rendered` (tab DOM), `site` (robots.txt, sitemap, homepage, llms.txt) or `probe` (opt-in fetches). Raw/rendered rules fall back to the other view when one is missing and each finding states the view actually used.

Scoring: each category starts at 100; an error costs 20, a warning 8, info 0.

## Indexability

| id | view | checks | fix |
|---|---|---|---|
| `idx.status` | raw | Page returns HTTP 200 ([docs](https://developers.google.com/search/docs/crawling-indexing/http-network-errors)) | Make the URL return 200, or redirect it (301) to the right page. |
| `idx.not-html` | raw | Response is HTML | Serve the page with Content-Type: text/html. |
| `idx.redirects` | raw | No redirect chain ([docs](https://developers.google.com/search/docs/crawling-indexing/301-redirects)) | Link directly to the final URL and make the first redirect point to the final destination. |
| `idx.noindex-meta` | raw | No noindex robots meta ([docs](https://developers.google.com/search/docs/crawling-indexing/block-indexing)) | Remove the noindex directive if the page should be found in search. |
| `idx.noindex-header` | raw | No noindex X-Robots-Tag header ([docs](https://developers.google.com/search/docs/crawling-indexing/block-indexing)) | Remove noindex from the X-Robots-Tag header (check the server, CDN and framework config). |
| `idx.robots-txt` | site | Allowed by robots.txt for Googlebot ([docs](https://developers.google.com/search/docs/crawling-indexing/robots/intro)) | Change the Disallow rule that matches this URL, or move the page. |
| `idx.canonical-missing` | raw | Canonical link present ([docs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)) | Add &lt;link rel="canonical" href="https://…/this-page"> with the absolute, final URL of the page. |
| `idx.canonical-multiple` | raw | Single canonical link ([docs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)) | Keep exactly one rel=canonical, inside &lt;head>. |
| `idx.canonical-target` | raw | Canonical points to this page ([docs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)) | Make the canonical self-referencing (the exact final URL of this page) unless this page really is a duplicate. |
| `idx.canonical-link-encoding` | raw | Internal links use the canonical URL form ([docs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)) | Generate canonical, internal links and sitemap entries from one URL builder so they encode the same way. |
| `idx.canonical-js` | rendered | Canonical not changed by JavaScript ([docs](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics#properly-inject-rel=canonical-link-tag)) | Output the final canonical in the server HTML. |
| `idx.canonical-probe` | probe | Canonical target is 200, indexable and self-canonical ([docs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)) | Point the canonical at a live, indexable URL whose own canonical is itself. |
| `idx.sitemap` | site | URL listed in the sitemap ([docs](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview)) | List the canonical URL (exactly as in rel=canonical) in the XML sitemap, and reference the sitemap in robots.txt. |
| `idx.soft404` | probe | Unknown URLs return 404 ([docs](https://developers.google.com/search/docs/crawling-indexing/http-network-errors#soft-404-errors)) | Return a real 404 (or 410) status for unknown paths; with a SPA, have the server check the route exists or render a noindex 404 page. |

## Meta

| id | view | checks | fix |
|---|---|---|---|
| `meta.title` | raw | Title present and unique ([docs](https://developers.google.com/search/docs/appearance/title-link)) | Add exactly one descriptive &lt;title> in &lt;head>, specific to this page. |
| `meta.title-length` | raw | Title length fits Google results ([docs](https://developers.google.com/search/docs/appearance/title-link)) | Put the distinctive words first and keep the title under roughly 55–60 characters. |
| `meta.title-homepage` | site | Title differs from the homepage ([docs](https://developers.google.com/search/docs/appearance/title-link)) | Generate a page-specific title (e.g. "&lt;Anime> pilgrimage map – &lt;Site>"). |
| `meta.description` | raw | Meta description present ([docs](https://developers.google.com/search/docs/appearance/snippet)) | Add one &lt;meta name="description" content="…"> that summarises this specific page (≈ 120–155 characters). |
| `meta.description-length` | raw | Meta description length ([docs](https://developers.google.com/search/docs/appearance/snippet)) | Aim for about 120–155 characters with the key information first. |
| `meta.description-homepage` | site | Description differs from the homepage ([docs](https://developers.google.com/search/docs/appearance/snippet)) | Generate the description from this page’s own content. |
| `meta.js-changed` | rendered | Title and description not changed by JavaScript | Render the final title and description on the server (SSR / prerender). |
| `meta.lang` | raw | <html lang> set and consistent with hreflang ([docs](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites)) | Set &lt;html lang="xx"> to the page language, matching its own hreflang entry. |
| `meta.viewport` | raw | Viewport meta present ([docs](https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing)) | Add &lt;meta name="viewport" content="width=device-width, initial-scale=1">. |
| `meta.charset` | raw | Charset declared | Put &lt;meta charset="utf-8"> first in &lt;head> (or send charset in Content-Type). |
| `meta.favicon` | raw | Favicon declared ([docs](https://developers.google.com/search/docs/appearance/favicon-in-search)) | Add &lt;link rel="icon" href="/favicon.png"> (square, larger than 48×48) and an apple-touch-icon. |

## hreflang

| id | view | checks | fix |
|---|---|---|---|
| `hl.points-elsewhere` | raw | hreflang alternates point to equivalent pages ([docs](https://developers.google.com/search/docs/specialty/international/localized-versions)) | For every language, output the URL of this same page in that language (and x-default to the default-language version of this page). |
| `hl.self` | raw | hreflang includes a self-reference ([docs](https://developers.google.com/search/docs/specialty/international/localized-versions)) | Add &lt;link rel="alternate" hreflang="&lt;this page language>" href="&lt;this exact URL>">. |
| `hl.x-default` | raw | x-default declared ([docs](https://developers.google.com/search/docs/specialty/international/localized-versions)) | Add hreflang="x-default" pointing to the default-language version of this page. |
| `hl.codes` | raw | hreflang codes are valid ([docs](https://developers.google.com/search/docs/specialty/international/localized-versions)) | Use ISO 639-1 language codes, optionally followed by an ISO 3166-1 alpha-2 region (en, en-GB, pt-BR, zh-Hant). |
| `hl.reciprocity` | probe | hreflang alternates are live and link back ([docs](https://developers.google.com/search/docs/specialty/international/localized-versions)) | Make sure each alternate page outputs the full, identical hreflang set including this URL. |

## Content

| id | view | checks | fix |
|---|---|---|---|
| `content.h1` | rendered | One non-empty h1 ([docs](https://developers.google.com/search/docs/appearance/title-link#page-titles)) | Give the page a single, descriptive &lt;h1> with the main topic (e.g. the anime title). |
| `content.heading-order` | rendered | Heading levels not skipped | Nest headings in order; style them with CSS instead of picking a level for its size. |
| `content.shell` | raw | Raw HTML contains the content ([docs](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)) | Server-render (SSR/SSG) or prerender the main content so it is in the HTML response. |
| `content.words` | rendered | Enough text content | Add useful, page-specific text (description, context, practical info). |
| `content.non-crawlable` | rendered | Navigation uses real links ([docs](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)) | Wrap each item in &lt;a href="/the/target/url"> (keep the click handler if needed, but the href must exist). |
| `content.child-links` | rendered | Listing page links to its items ([docs](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)) | Give each item a crawlable &lt;a href> to its detail page. |
| `content.link-quality` | rendered | Internal links are followable ([docs](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)) | Use real URLs in href and drop rel="nofollow" on internal links. |
| `content.broken-links` | probe | No broken links ([docs](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)) | Update or remove the links listed (or redirect the targets). |

## Images

| id | view | checks | fix |
|---|---|---|---|
| `img.alt` | rendered | Images have alt text ([docs](https://developers.google.com/search/docs/appearance/google-images#use-descriptive-alt-text)) | Add a short alt describing the image (e.g. the anime / location name). Use alt="" only for purely decorative images. |
| `img.dimensions` | rendered | Images declare width and height ([docs](https://web.dev/articles/optimize-cls#images-without-dimensions)) | Add width and height attributes matching the intrinsic aspect ratio (CSS can still resize). |
| `img.oversized` | rendered | Images not much larger than displayed ([docs](https://web.dev/articles/serve-responsive-images)) | Serve resized images with srcset/sizes or an image CDN. |
| `img.lazy` | rendered | Offscreen images lazy-loaded, above-the-fold not ([docs](https://web.dev/articles/browser-level-image-lazy-loading)) | Add loading="lazy" to below-the-fold images; never on the main above-the-fold image. |
| `img.hotlinked` | rendered | Images served from your own domain | Host the images (or licensed copies) on your own domain or CDN. |

## Structured data

| id | view | checks | fix |
|---|---|---|---|
| `schema.parse` | raw | JSON-LD parses ([docs](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data)) | Fix the JSON (trailing commas, unescaped quotes, comments are invalid); test with the Rich Results Test. |
| `schema.present` | raw | Structured data matches the page type ([docs](https://developers.google.com/search/docs/appearance/structured-data/search-gallery)) | Add JSON-LD describing what the page is about. |
| `schema.properties` | raw | Rich-result properties present ([docs](https://developers.google.com/search/docs/appearance/structured-data/search-gallery)) | Add the missing properties listed. |
| `schema.homepage` | site | Structured data specific to this page | Generate page-specific JSON-LD (Article, Event, ItemList, BreadcrumbList…) next to the site-wide block. |
| `schema.js-only` | rendered | Structured data in the raw HTML | Output the JSON-LD in the server HTML. |

## Share

| id | view | checks | fix |
|---|---|---|---|
| `share.og` | raw | Open Graph tags present ([docs](https://ogp.me/)) | Add &lt;meta property="og:…" content="…"> tags in &lt;head> of the server HTML. |
| `share.twitter-card` | raw | twitter:card set ([docs](https://developer.x.com/en/docs/x-for-websites/cards/overview/markup)) | Add &lt;meta name="twitter:card" content="summary_large_image">. |
| `share.og-url` | raw | og:url matches the canonical ([docs](https://ogp.me/)) | Output the same absolute URL in og:url and rel=canonical. |
| `share.js-only` | rendered | Share tags in the raw HTML ([docs](https://ogp.me/)) | Render Open Graph / Twitter tags on the server (SSR or prerender for bots). |
| `share.truncation` | raw | Share title/description fit the platforms | Keep og:title under ~60 characters and og:description under ~155 characters. |
| `share.image` | raw | Share image loads and fits every platform ([docs](https://developers.facebook.com/docs/sharing/webmasters/images)) | Serve a 1200×630 JPEG or PNG under 600 KB, publicly reachable over https, with og:image:width/height. |
| `share.image-origin` | site | Share image is page-specific and self-hosted | Generate a page-specific share image (e.g. cover + title) hosted on your own domain. |

## Performance

| id | view | checks | fix |
|---|---|---|---|
| `perf.html-size` | raw | HTML weight under 150 KB ([docs](https://developers.google.com/search/docs/crawling-indexing/googlebot#how-googlebot-accesses-your-site)) | Move inline data, CSS and SVG out of the HTML; paginate long lists. |
| `perf.framework` | raw | Framework payload under 50 KB | Only transfer what the page needs; strip unused fields, paginate, or fetch secondary data after load. |
| `perf.inline-css` | raw | Inline CSS and fonts are lean ([docs](https://web.dev/articles/extract-critical-css)) | Inline only critical CSS; load fonts from a cached stylesheet and subset them (unicode-range). |
| `perf.vitals` | rendered | Web Vitals within "good" thresholds ([docs](https://web.dev/articles/vitals)) | LCP: optimise the hero image and server response. CLS: reserve space for images/ads. INP: break up long JavaScript tasks. |
| `perf.image-hosts` | rendered | Few third-party image hosts | Serve images from your own domain/CDN; preconnect to the one or two hosts you must keep. |

## AI & crawlers

| id | view | checks | fix |
|---|---|---|---|
| `ai.robots` | site | AI crawler access (robots.txt) ([docs](https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers#google-extended)) | Allow or disallow each crawler deliberately, per your policy. |
| `ai.llms` | site | llms.txt ([docs](https://llmstxt.org/)) | Optional. Add /llms.txt only if you want to. |
