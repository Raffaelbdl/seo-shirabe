# Architecture

```
 side panel (React)  ──runtime.sendMessage──▶  background service worker
   │  executeScript(extractPage)                 │ fetch (credentials: omit, size cap, timeout)
   │  tabs.sendMessage('shirabe/vitals')         │ webRequest (observe) → redirect chain
   ▼                                             │ declarativeNetRequest session rule → bot User-Agent
 inspected tab                                   │ runtime.sendMessage({target:'offscreen'})
   └ vitals content script (runtime-registered)  ▼
                                               offscreen document: DOMParser → extractPage
```

## Two views, one extractor

`src/lib/extract/extractPage.ts` extracts every signal (head tags, JSON-LD,
headings, links, images, text, framework payloads, inline CSS, clickable
non-links…). It is **self-contained** (no imports at runtime) so it can be:

- injected into the tab with `chrome.scripting.executeScript({ func })` → rendered view;
- run in the offscreen document on `DOMParser` output → raw view (the MV3 service
  worker has no DOM). `DOMParser` documents are inert: no scripts, no subresources;
- run by Playwright in tests (`page.evaluate`).

Gotcha found while testing: `executeScript` drops `null` properties from `args`,
so the extractor checks `typeof html !== 'string'` rather than `html === null`.

## Data flow of an audit (side panel, `useAudit.ts`)

1. In parallel: `raw` (background fetch + offscreen parse) and `rendered`
   (executeScript in the tab + Web Vitals from the content script).
2. Then in parallel: `site` (robots.txt, sitemap(s), llms.txt, homepage summary)
   and share-image checks (fetched by the panel, so the bytes can become a `blob:`
   URL after the header checks pass).
3. `audit(input)` (pure) runs every rule over whatever is available, recomputed as
   each piece arrives. Probes add to `input.probes` on demand.

## Rules

`src/lib/rules/*.ts`: each rule has an id, category, view, title, why, fix, docs
and a `check(ctx)` returning hits (`[]` = passed, `null` = not applicable).
`engine.ts` turns hits into findings, sorts them, computes scores (100 − 20 per
error − 8 per warning) and the indexability verdict (findings flagged
`blocksIndexing`). The catalogue is listed in [rules.md](rules.md).

Platform preview behaviour lives in data (`src/rules/share/*.json`): fallback
chain per field, what is displayed, truncation, image limits, debugger URL,
notes, `source` URLs and `lastVerified`. Update those files when platforms
change; `tests/unit/lib.test.ts` checks every file is complete and dated.

## Security

- Page-derived values are rendered as React text only; no `dangerouslySetInnerHTML`,
  no page HTML in extension frames (CSP: `frame-src 'none'`, `script-src 'self'`).
- Share images are displayed only from `blob:` URLs created after the format,
  type and size checks pass (SVG never displayed).
- Every fetch: `credentials: 'omit'`, http(s) only (also after redirects), body
  caps (15 MB HTML, 10 MB images, 50 MB sitemaps in total), 20 s timeout.
- Messages are validated at every boundary (`lib/messages.ts`): the background only
  answers extension pages, the offscreen document only parses, the vitals content
  script's answers are reduced to finite numbers, injected-script results are
  shape-checked.
- Host access is optional and per origin; the bot User-Agent rule only matches
  requests initiated by the extension itself (`initiatorDomains: [extension id]`,
  `tabIds: [-1]`) and is removed right after the fetch.

## Testing

- `tests/unit/acceptance.test.ts`: the handover §9 cases on synthetic fixtures
  (raw and rendered extraction in real Chromium).
- `tests/unit/lib.test.ts`: URL, robots, sitemap (gzip, index), image headers,
  pixels, permissions, message validation, compare exports, link probe.
- `tests/e2e/extension.spec.ts`: loads the built extension, audits pages from a
  local server, checks the panel UI, Show in page, blob images, redirect chain,
  bot User-Agent (asserted server-side), site files, compare.
