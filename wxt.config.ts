import { defineConfig } from 'wxt';

// E2E builds get a blanket host permission so Playwright can audit local
// fixture pages without the runtime permission prompt. Never used for the
// build you load in your own browser.
// (globalThis lookup: @types/node is deliberately not a dependency.)
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const e2e = env.SHIRABE_E2E === '1';

export default defineConfig({
  srcDir: 'src',
  outDir: '.output',
  imports: false,
  manifestVersion: 3,
  browser: 'chrome',
  outDirTemplate: e2e ? 'chrome-mv3-e2e' : undefined,
  manifest: {
    name: 'Shirabe — SEO & share inspector',
    short_name: 'Shirabe',
    description:
      'Inspect every SEO signal of a page (raw HTML vs rendered DOM), see why it matters and how to fix it, preview share cards and compare pages.',
    minimum_chrome_version: '116',
    action: { default_title: 'Open Shirabe' },
    permissions: [
      'sidePanel',
      'storage',
      'activeTab',
      'scripting',
      'offscreen',
      'webRequest',
      'declarativeNetRequest',
    ],
    optional_host_permissions: ['<all_urls>'],
    host_permissions: e2e ? ['<all_urls>'] : [],
    content_security_policy: {
      extension_pages:
        "default-src 'self'; script-src 'self'; object-src 'none'; style-src 'self'; img-src 'self' blob:; connect-src http: https:; frame-src 'none'; base-uri 'none'; form-action 'none'",
    },
  },
  vite: () => ({
    oxc: { jsx: { runtime: 'automatic' } },
    build: { target: 'chrome116' },
  }),
});
