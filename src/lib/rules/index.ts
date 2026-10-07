import type { AuditInput, AuditReport } from '../types';
import { contentRules } from './content';
import { runRules, type Rule } from './engine';
import { hreflangRules } from './hreflang';
import { imageRules } from './images';
import { indexabilityRules } from './indexability';
import { metaRules } from './meta';
import { aiRules, performanceRules } from './performance';
import { schemaChecks } from './schema';
import { shareRules } from './share';

export const RULES: Rule[] = [
  ...indexabilityRules,
  ...metaRules,
  ...hreflangRules,
  ...contentRules,
  ...imageRules,
  ...schemaChecks,
  ...shareRules,
  ...performanceRules,
  ...aiRules,
];

export function audit(input: AuditInput): AuditReport {
  return runRules(input, RULES);
}

export { CATEGORIES } from './engine';
