// docs/rules.md is generated from the rule catalogue. Regenerate with:
//   UPDATE_DOCS=1 pnpm test rules-doc
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { expect, it } from 'vitest';
import { CATEGORIES } from '../../src/lib/rules/engine';
import { RULES } from '../../src/lib/rules';

function render(): string {
  const lines = [
    '# Rule catalogue',
    '',
    '_Generated from `src/lib/rules/` by `tests/unit/rules-doc.test.ts` — do not edit by hand._',
    '',
    'Each rule is a pure function over the collected data. `view` is the data it reads: `raw` (server HTML), `rendered` (tab DOM), `site` (robots.txt, sitemap, homepage, llms.txt) or `probe` (opt-in fetches). Raw/rendered rules fall back to the other view when one is missing and each finding states the view actually used.',
    '',
    'Scoring: each category starts at 100; an error costs 20, a warning 8, info 0.',
  ];
  for (const c of CATEGORIES) {
    lines.push('', `## ${c.label}`, '', '| id | view | checks | fix |', '|---|---|---|---|');
    for (const r of RULES.filter((x) => x.category === c.id)) {
      const docs = r.docs ? ` ([docs](${r.docs}))` : '';
      lines.push(`| \`${r.id}\` | ${r.view} | ${r.title}${docs} | ${r.fix.replace(/\|/g, '\\|').replace(/</g, '&lt;')} |`);
    }
  }
  return lines.join('\n') + '\n';
}

it('docs/rules.md is up to date', () => {
  const path = 'docs/rules.md';
  const next = render();
  if (process.env.UPDATE_DOCS || !existsSync(path)) writeFileSync(path, next);
  expect(readFileSync(path, 'utf8')).toBe(next);
});
