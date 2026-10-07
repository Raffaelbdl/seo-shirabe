// Shared data model. Everything collected from pages is untrusted text: it is
// only ever rendered as text (React escaping), never as HTML.

export type PageView = 'raw' | 'rendered';
export type FindingView = 'raw' | 'rendered' | 'site' | 'probe';
export type Severity = 'error' | 'warning' | 'info';
export type Category =
  | 'indexability'
  | 'meta'
  | 'hreflang'
  | 'content'
  | 'images'
  | 'schema'
  | 'share'
  | 'performance'
  | 'ai';

export interface MetaTag {
  name: string | null;
  property: string | null;
  httpEquiv: string | null;
  charset: string | null;
  itemprop: string | null;
  content: string | null;
  inHead: boolean;
}

export interface HeadLink {
  rel: string;
  /** Absolute URL, or null when the href could not be resolved. */
  href: string | null;
  rawHref: string;
  hreflang: string | null;
  type: string | null;
  sizes: string | null;
  media: string | null;
  inHead: boolean;
}

export interface Heading {
  level: number;
  text: string;
  selector: string;
}

export type AnchorKind = 'http' | 'hash' | 'js' | 'mailto' | 'tel' | 'empty' | 'other';

export interface Anchor {
  href: string | null;
  rawHref: string;
  text: string;
  rel: string;
  kind: AnchorKind;
  internal: boolean;
  selector: string;
}

export interface ImageInfo {
  src: string | null;
  rawSrc: string;
  /** Unresolved data-src / data-lazy-src when the real src is missing or a placeholder. */
  lazySrc: string | null;
  alt: string | null;
  decorative: boolean;
  widthAttr: string | null;
  heightAttr: string | null;
  loading: string | null;
  srcset: string | null;
  host: string | null;
  selector: string;
  /** Rendered view only. */
  natural?: { w: number; h: number };
  displayed?: { w: number; h: number };
  belowFold?: boolean;
}

export interface JsonLdBlock {
  raw: string;
  parsed: unknown;
  error: string | null;
  types: string[];
  selector: string;
}

export interface ClickableCandidate {
  selector: string;
  tag: string;
  text: string;
  reasons: string[];
  /** Tag + classes, used to group repeated list items. */
  group: string;
}

export type FrameworkKind =
  | 'angular-ng-state'
  | 'next-data'
  | 'next-rsc'
  | 'nuxt'
  | 'remix'
  | 'sveltekit'
  | 'apollo'
  | 'redux-initial-state';

export interface FrameworkPayload {
  kind: FrameworkKind;
  bytes: number;
}

export interface ResourceSummary {
  count: number;
  transferBytes: number;
  byType: Record<string, { count: number; transferBytes: number }>;
}

export interface PageData {
  url: string;
  view: PageView;
  lang: string | null;
  charset: string | null;
  titles: { text: string; inHead: boolean }[];
  metas: MetaTag[];
  headLinks: HeadLink[];
  headings: Heading[];
  anchors: Anchor[];
  images: ImageInfo[];
  jsonLd: JsonLdBlock[];
  microdataTypes: string[];
  rdfaTypes: string[];
  text: string;
  wordCount: number;
  textBlocks: string[];
  framework: FrameworkPayload[];
  inlineStyleBytes: number;
  inlineStyleCount: number;
  fontFaceCount: number;
  dataUriCount: number;
  dataUriBytes: number;
  inlineScriptBytes: number;
  scriptCount: number;
  stylesheetCount: number;
  bodyElementCount: number;
  hasBreadcrumbNav: boolean;
  /** Rendered view only. */
  clickables: ClickableCandidate[];
  resources?: ResourceSummary;
  truncated: { anchors: boolean; images: boolean; text: boolean };
}

export interface RedirectHop {
  url: string;
  status: number;
  location: string;
}

export interface FetchInfo {
  requestedUrl: string;
  finalUrl: string;
  ok: boolean;
  status: number;
  statusText: string;
  headers: [string, string][];
  contentType: string | null;
  bytes: number;
  truncated: boolean;
  redirects: RedirectHop[];
  timingMs: number;
  userAgent: string | null;
  error: string | null;
}

export interface RawAudit {
  fetch: FetchInfo;
  /** Null when the response was not HTML or the fetch failed. */
  page: PageData | null;
}

export interface WebVitals {
  LCP?: number;
  CLS?: number;
  INP?: number;
  TTFB?: number;
  FCP?: number;
}

export interface RenderedAudit {
  page: PageData;
  vitals: WebVitals | null;
  tabId: number;
}

export interface RobotsGroupMatch {
  agent: string;
  allowed: boolean;
  /** The rule that decided, or null when no rule matched. */
  rule: string | null;
  group: string | null;
}

export interface RobotsInfo {
  url: string;
  status: number;
  found: boolean;
  error: string | null;
  sitemaps: string[];
  agents: RobotsGroupMatch[];
  bytes: number;
}

export interface SitemapInfo {
  checked: string[];
  found: boolean;
  /** Whether the audited URL (canonical or final URL) is listed. */
  listed: boolean | null;
  listedAs: string | null;
  alternates: { hreflang: string; href: string }[];
  urlCount: number;
  errors: string[];
  capped: boolean;
}

export interface LlmsInfo {
  url: string;
  present: boolean;
  status: number;
  bytes: number;
}

export interface HomepageSummary {
  url: string;
  status: number;
  title: string | null;
  description: string | null;
  ogImage: string | null;
  jsonLd: string[];
  isCurrentPage: boolean;
}

export interface SiteAudit {
  origin: string;
  robots: RobotsInfo | null;
  sitemap: SitemapInfo | null;
  llms: LlmsInfo | null;
  homepage: HomepageSummary | null;
}

export interface ProbePageSummary {
  url: string;
  finalUrl: string;
  status: number;
  title: string | null;
  canonical: string | null;
  noindex: boolean;
  hreflang: { lang: string; href: string }[];
  error: string | null;
}

export interface Soft404Probe {
  probeUrl: string;
  result: ProbePageSummary;
}

export interface HreflangProbe {
  alternates: { lang: string; href: string; result: ProbePageSummary; linksBack: boolean }[];
}

export interface CanonicalProbe {
  canonical: string;
  result: ProbePageSummary;
}

export interface LinkCheck {
  url: string;
  status: number;
  ok: boolean;
  method: 'HEAD' | 'GET';
  error: string | null;
  skipped?: 'no-permission' | 'not-http';
}

export interface BrokenLinksProbe {
  checked: LinkCheck[];
  capped: boolean;
}

export interface Probes {
  soft404?: Soft404Probe;
  hreflang?: HreflangProbe;
  canonical?: CanonicalProbe;
  links?: BrokenLinksProbe;
}

export type ImageFormat = 'jpeg' | 'png' | 'gif' | 'webp' | 'avif' | 'svg' | 'bmp' | 'ico' | 'unknown';

export interface ShareImageCheck {
  url: string;
  /** Which tag the URL came from, e.g. og:image. */
  source: string;
  https: boolean;
  status: number;
  contentType: string | null;
  bytes: number;
  format: ImageFormat;
  width: number | null;
  height: number | null;
  host: string | null;
  error: string | null;
  /** blob: URL safe to display in the panel, only set when every check passed. */
  blobUrl?: string;
}

export interface AuditInput {
  url: string;
  raw?: RawAudit | null;
  rendered?: RenderedAudit | null;
  site?: SiteAudit | null;
  probes?: Probes;
  images?: ShareImageCheck[];
}

export interface Finding {
  ruleId: string;
  category: Category;
  severity: Severity;
  view: FindingView;
  title: string;
  value?: string;
  why: string;
  fix: string;
  docs?: string;
  selector?: string;
  /** Prevents the page from being indexed — feeds the indexability verdict. */
  blocksIndexing?: boolean;
}

export interface AuditReport {
  url: string;
  findings: Finding[];
  passed: { ruleId: string; title: string; category: Category }[];
  scores: Record<Category, number>;
  indexable: boolean;
  indexabilityReasons: string[];
}
