# Supply chain

Same rules as the site:

- **pnpm** only, lockfile committed, `pnpm install --frozen-lockfile` in CI.
- `minimumReleaseAge: 10080` (pnpm-workspace.yaml): only versions published at
  least 7 days ago are installed.
- Dependency lifecycle scripts are blocked (pnpm 10 default); the
  `onlyBuiltDependencies` allowlist is minimal (`esbuild`, which the current
  toolchain does not even install, so effectively nothing runs).
- `save-exact=true` (.npmrc): exact versions, no ranges.
- **Minimal dependencies**: WXT, React, react-dom, web-vitals, Vitest, Playwright
  (+ TypeScript, Vite and the @types needed to compile). Anything else is
  proposed to Raffael first (name, purpose, maintainers, weekly downloads,
  publish date of the version). Platform APIs are preferred: image dimensions are
  read from file headers, sitemaps are scanned without an XML library, gzip uses
  `DecompressionStream`, icons are generated with `node:zlib`, tests extract DOM
  in real Chromium instead of jsdom.
- No `@latest`, no unknown `npx`.
- No remote code: strict extension CSP (`script-src 'self'`), everything bundled.
- If CI is added: GitHub Actions pinned by commit SHA.

`@types/node` is deliberately not a dependency: `pnpm typecheck` covers `src/`
and `wxt.config.ts`; test files are transpiled (not type-checked) by Vitest and
Playwright.
