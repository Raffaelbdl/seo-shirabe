// "Copy report": a Markdown summary meant to be pasted into handovers.
import { CATEGORIES } from './rules/engine';
import type { AuditReport, Finding } from './types';

const ICON: Record<Finding['severity'], string> = { error: '🔴', warning: '🟠', info: '🔵' };

export function reportMarkdown(report: AuditReport, opts: { at?: Date; views?: string[] } = {}): string {
  const at = (opts.at ?? new Date()).toISOString().slice(0, 16).replace('T', ' ');
  const lines: string[] = [
    `# SEO audit — ${report.url}`,
    '',
    `_${at} UTC · Shirabe · views: ${opts.views?.join(', ') || 'raw'}_`,
    '',
    `**${report.indexable ? 'Indexable' : 'Not indexable'}**${report.indexable ? '' : ': ' + report.indexabilityReasons.join('; ')}`,
    '',
    '| Category | Score | Errors | Warnings |',
    '|---|---|---|---|',
  ];
  for (const c of CATEGORIES) {
    const f = report.findings.filter((x) => x.category === c.id);
    if (!f.length && !report.passed.some((p) => p.category === c.id)) continue;
    lines.push(`| ${c.label} | ${report.scores[c.id]} | ${f.filter((x) => x.severity === 'error').length} | ${f.filter((x) => x.severity === 'warning').length} |`);
  }
  for (const c of CATEGORIES) {
    const f = report.findings.filter((x) => x.category === c.id);
    if (!f.length) continue;
    lines.push('', `## ${c.label}`, '');
    for (const x of f) {
      lines.push(`- ${ICON[x.severity]} **${x.title}** _(${x.view})_`);
      if (x.value) lines.push(...x.value.split('\n').slice(0, 8).map((v) => `  - \`${v.replace(/`/g, "'")}\``));
      lines.push(`  - Why: ${x.why}`, `  - Fix: ${x.fix}${x.docs ? ` ([docs](${x.docs}))` : ''}`);
    }
  }
  if (report.passed.length) {
    lines.push('', '## Passed', '', report.passed.map((p) => `- ✅ ${p.title}`).join('\n'));
  }
  return lines.join('\n');
}
