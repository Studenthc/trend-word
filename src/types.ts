export type SourceType =
  | "scys-mcp"
  | "producthunt"
  | "github"
  | "x-timeline"
  | "reddit-feed"
  | "google-trends"
  | "manual"
  | "fixtures";

export type SourceHealthStatus = "available" | "partial" | "blocked" | "empty" | "unverified";

export type AuthorRef = {
  id?: string;
  name: string;
  profileUrl?: string;
};

export type Engagement = {
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
  score?: number;
};

export type Occurrence = {
  rawSignalId: string;
  sourceType: SourceType;
  seenAt: string;
  context?: string;
};

export type RawSignal = {
  id: string;
  sourceType: SourceType;
  sourceName: string;
  sourceUrl: string;
  externalId?: string;
  title?: string;
  body?: string;
  excerpt?: string;
  author?: AuthorRef;
  community?: string;
  publishedAt?: string;
  fetchedAt: string;
  language?: string;
  sourceTier: "first_party" | "community" | "market" | "search";
  engagement?: Engagement;
  sourceFingerprint: string;
  evidenceStatus: "verified" | "partial" | "failed";
  failureReason?: string;
};

export type Expression = {
  id: string;
  text: string;
  normalizedText: string;
  aliases: string[];
  kind: "search_term" | "product" | "model" | "feature" | "concept" | "problem" | "play";
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: Occurrence[];
  sourceFamilies: string[];
  independentAuthors: number;
  independentCommunities: number;
  independentPublishers: number;
  lifecycle: "new" | "watch" | "rising" | "stable" | "fading" | "mature";
  trendState: "unknown" | "rising" | "flat" | "declining" | "volatile";
  qualification: "discovered" | "corroborating" | "qualified" | "rejected";
  rejectionReasons: string[];
};

export type Evidence = {
  id: string;
  subjectId: string;
  claimType:
    | "newness"
    | "trend"
    | "user_problem"
    | "adoption"
    | "search_intent"
    | "serp_competition"
    | "monetization"
    | "delivery"
    | "risk";
  rawSignalId: string;
  quote: string;
  location: "title" | "body" | "comment" | "query" | "url" | "metadata";
  capturedAt: string;
  evidenceGrade: "direct" | "reported" | "estimated" | "inferred";
  independentFrom?: string[];
  notes?: string;
};

export type TrendSnapshot = {
  expressionId: string;
  provider: "google_trends" | "suggest" | "manual";
  capturedAt: string;
  window: "4h" | "24h" | "7d" | "30d" | "12m" | "5y";
  region?: string;
  value?: number;
  delta?: number;
  relatedQueries: Array<{ text: string; growth?: number; type?: "top" | "rising" }>;
  status: "verified" | "unavailable" | "partial";
  notes?: string;
};

export type ValidationState = {
  freshness: "unknown" | "confirmed" | "stale";
  trend: "unknown" | "rising" | "stable" | "declining" | "event_spike";
  intent: "unknown" | "informational" | "tool" | "commercial" | "service";
  demand: "unknown" | "single_signal" | "repeated" | "cross_source";
  competition: "unknown" | "thin" | "mixed" | "strong";
  monetization: "unknown" | "reported" | "observed" | "verified";
  delivery: "unknown" | "possible" | "quick_mvp" | "blocked";
  confidence: "low" | "medium" | "high";
  missingChecks: string[];
};

export type RiskFlag = string;

export type Opportunity = {
  id: string;
  primaryExpressionId: string;
  title: string;
  summary: string;
  audiences: string[];
  userProblems: string[];
  recommendedArtifact: "tool" | "content" | "service" | "directory" | "plugin" | "observe" | "none";
  evidenceIds: string[];
  validation: ValidationState;
  riskFlags: RiskFlag[];
  status: "new" | "watch" | "validating" | "actionable" | "paused" | "rejected" | "executed";
  createdAt: string;
  updatedAt: string;
};

export type SourceHealth = {
  sourceType: SourceType;
  status: SourceHealthStatus;
  attemptedAt: string;
  endpointCount?: number;
  successfulEndpointCount?: number;
  itemCount: number;
  failureReasons: string[];
  coverageNotes: string[];
};

export type SourceAdapterContext = {
  workspaceRoot: string;
  fetchedAt: string;
};

export type SourceAdapterResult = {
  signals: RawSignal[];
  health: SourceHealth;
};

export type SourceAdapter = {
  sourceType: SourceType;
  collect(context: SourceAdapterContext): Promise<SourceAdapterResult>;
};
