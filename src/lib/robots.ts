// robots.txt parsing and matching per RFC 9309 / Google's documented behaviour:
// - the most specific matching user-agent group wins, groups with the same
//   user-agent are merged, "*" is the fallback;
// - inside a group the longest matching rule wins, Allow wins ties;
// - "*" matches any sequence, "$" anchors the end.
// https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt
import { decodeSafe } from './url';

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}

export interface ParsedRobots {
  groups: RobotsGroup[];
  sitemaps: string[];
}

export function parseRobots(text: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent' || key === 'useragent' || key === 'user agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      lastWasAgent = false;
      if (!current) continue; // rules before any user-agent are ignored
      if (key === 'disallow' && value === '') continue; // empty disallow = allow all
      current.rules.push({ allow: key === 'allow', pattern: value });
    } else if (key === 'sitemap' || key === 'site-map') {
      if (value) sitemaps.push(value);
    } else {
      lastWasAgent = false;
    }
  }
  return { groups, sitemaps };
}

/** Fallback chains for crawler tokens: the first token with a group wins. */
const AGENT_FALLBACKS: Record<string, string[]> = {
  'googlebot-image': ['googlebot'],
  'googlebot-news': ['googlebot'],
  'googlebot-video': ['googlebot'],
  'storebot-google': ['googlebot'],
};

export function selectGroup(robots: ParsedRobots, agent: string): { rules: RobotsRule[]; matched: string | null } {
  const tokens = [agent.toLowerCase(), ...(AGENT_FALLBACKS[agent.toLowerCase()] ?? []), '*'];
  for (const token of tokens) {
    const groups = robots.groups.filter((g) => g.agents.includes(token));
    if (groups.length) return { rules: groups.flatMap((g) => g.rules), matched: token };
  }
  return { rules: [], matched: null };
}

function normalizePath(p: string): string {
  // Compare on a canonical percent-encoding so "/a%20b" and "/a b" match.
  try {
    return encodeURI(decodeSafe(p));
  } catch {
    return p;
  }
}

function patternToRegExp(pattern: string): RegExp {
  let p = normalizePath(pattern);
  const anchored = p.endsWith('$');
  if (anchored) p = p.slice(0, -1);
  const body = p
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

export function matchRule(rules: RobotsRule[], pathAndQuery: string): RobotsRule | null {
  const path = normalizePath(pathAndQuery);
  let best: RobotsRule | null = null;
  let bestLen = -1;
  for (const r of rules) {
    if (!patternToRegExp(r.pattern).test(path)) continue;
    const len = r.pattern.length;
    if (len > bestLen || (len === bestLen && r.allow && best && !best.allow)) {
      best = r;
      bestLen = len;
    }
  }
  return best;
}

export function isAllowed(
  robots: ParsedRobots,
  agent: string,
  url: string,
): { allowed: boolean; rule: RobotsRule | null; group: string | null } {
  let pathAndQuery = '/';
  try {
    const u = new URL(url);
    pathAndQuery = u.pathname + u.search;
  } catch {
    /* keep / */
  }
  if (pathAndQuery === '/robots.txt') return { allowed: true, rule: null, group: null };
  const { rules, matched } = selectGroup(robots, agent);
  const rule = matchRule(rules, pathAndQuery);
  return { allowed: !rule || rule.allow, rule, group: matched };
}

export const SEARCH_BOTS = ['Googlebot', 'Bingbot'];
export const AI_BOTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Google-Extended',
  'PerplexityBot',
  'CCBot',
  'Applebot-Extended',
];
