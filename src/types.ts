import { z } from "zod";

export const sourceTypeSchema = z.enum([
  "scys-mcp",
  "producthunt",
  "github",
  "x-timeline",
  "reddit-feed",
  "google-trends",
  "manual",
  "fixtures",
]);

export type SourceType = z.infer<typeof sourceTypeSchema>;

export const sourceHealthStatusSchema = z.enum(["available", "partial", "blocked", "empty", "unverified"]);

export type SourceHealthStatus = z.infer<typeof sourceHealthStatusSchema>;

const authorRefSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  profileUrl: z.string().optional(),
});

export type AuthorRef = z.infer<typeof authorRefSchema>;

const engagementSchema = z.object({
  likes: z.number().optional(),
  comments: z.number().optional(),
  shares: z.number().optional(),
  views: z.number().optional(),
  score: z.number().optional(),
});

export type Engagement = z.infer<typeof engagementSchema>;

const occurrenceSchema = z.object({
  rawSignalId: z.string(),
  sourceType: sourceTypeSchema,
  seenAt: z.string(),
  context: z.string().optional(),
});

export type Occurrence = z.infer<typeof occurrenceSchema>;

export const rawSignalSchema = z.object({
  id: z.string(),
  sourceType: sourceTypeSchema,
  sourceName: z.string(),
  sourceUrl: z.string(),
  externalId: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  excerpt: z.string().optional(),
  author: authorRefSchema.optional(),
  community: z.string().optional(),
  publishedAt: z.string().optional(),
  fetchedAt: z.string(),
  language: z.string().optional(),
  sourceTier: z.enum(["first_party", "community", "market", "search"]),
  engagement: engagementSchema.optional(),
  sourceFingerprint: z.string(),
  evidenceStatus: z.enum(["verified", "partial", "failed"]),
  failureReason: z.string().optional(),
});

export type RawSignal = z.infer<typeof rawSignalSchema>;
export const parseRawSignal = (value: unknown): RawSignal => rawSignalSchema.parse(value);

export const expressionSchema = z.object({
  id: z.string(),
  text: z.string(),
  normalizedText: z.string(),
  aliases: z.array(z.string()),
  kind: z.enum(["search_term", "product", "model", "feature", "concept", "problem", "play"]),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  occurrences: z.array(occurrenceSchema),
  sourceFamilies: z.array(z.string()),
  independentAuthors: z.number().int().nonnegative(),
  independentCommunities: z.number().int().nonnegative(),
  independentPublishers: z.number().int().nonnegative(),
  lifecycle: z.enum(["new", "watch", "rising", "stable", "fading", "mature"]),
  trendState: z.enum(["unknown", "rising", "flat", "declining", "volatile"]),
  qualification: z.enum(["discovered", "corroborating", "qualified", "rejected"]),
  rejectionReasons: z.array(z.string()),
});

export type Expression = z.infer<typeof expressionSchema>;

export const evidenceSchema = z.object({
  id: z.string(),
  subjectId: z.string(),
  claimType: z.enum([
    "newness",
    "trend",
    "user_problem",
    "adoption",
    "search_intent",
    "serp_competition",
    "monetization",
    "delivery",
    "risk",
  ]),
  rawSignalId: z.string(),
  quote: z.string(),
  location: z.enum(["title", "body", "comment", "query", "url", "metadata"]),
  capturedAt: z.string(),
  evidenceGrade: z.enum(["direct", "reported", "estimated", "inferred"]),
  independentFrom: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export type Evidence = z.infer<typeof evidenceSchema>;

export const trendSnapshotSchema = z.object({
  expressionId: z.string(),
  provider: z.enum(["google_trends", "suggest", "manual"]),
  capturedAt: z.string(),
  window: z.enum(["4h", "24h", "7d", "30d", "12m", "5y"]),
  region: z.string().optional(),
  value: z.number().optional(),
  delta: z.number().optional(),
  relatedQueries: z.array(z.object({
    text: z.string(),
    growth: z.number().optional(),
    type: z.enum(["top", "rising"]).optional(),
  })),
  status: z.enum(["verified", "unavailable", "partial"]),
  notes: z.string().optional(),
});

export type TrendSnapshot = z.infer<typeof trendSnapshotSchema>;

export const validationStateSchema = z.object({
  freshness: z.enum(["unknown", "confirmed", "stale"]),
  trend: z.enum(["unknown", "rising", "stable", "declining", "event_spike"]),
  intent: z.enum(["unknown", "informational", "tool", "commercial", "service"]),
  demand: z.enum(["unknown", "single_signal", "repeated", "cross_source"]),
  competition: z.enum(["unknown", "thin", "mixed", "strong"]),
  monetization: z.enum(["unknown", "reported", "observed", "verified"]),
  delivery: z.enum(["unknown", "possible", "quick_mvp", "blocked"]),
  confidence: z.enum(["low", "medium", "high"]),
  missingChecks: z.array(z.string()),
});

export type ValidationState = z.infer<typeof validationStateSchema>;
export type RiskFlag = string;

export const opportunitySchema = z.object({
  id: z.string(),
  primaryExpressionId: z.string(),
  title: z.string(),
  summary: z.string(),
  audiences: z.array(z.string()),
  userProblems: z.array(z.string()),
  recommendedArtifact: z.enum(["tool", "content", "service", "directory", "plugin", "observe", "none"]),
  evidenceIds: z.array(z.string()),
  validation: validationStateSchema,
  riskFlags: z.array(z.string()),
  status: z.enum(["new", "watch", "validating", "actionable", "paused", "rejected", "executed"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Opportunity = z.infer<typeof opportunitySchema>;

export const sourceHealthSchema = z.object({
  sourceType: sourceTypeSchema,
  status: sourceHealthStatusSchema,
  attemptedAt: z.string(),
  endpointCount: z.number().int().nonnegative().optional(),
  successfulEndpointCount: z.number().int().nonnegative().optional(),
  itemCount: z.number().int().nonnegative(),
  failureReasons: z.array(z.string()),
  coverageNotes: z.array(z.string()),
});

export type SourceHealth = z.infer<typeof sourceHealthSchema>;
export const parseSourceHealth = (value: unknown): SourceHealth => sourceHealthSchema.parse(value);

const radarConfigShape = z.object({
  sources: z.object({
    required: z.array(sourceTypeSchema),
    bestEffort: z.array(sourceTypeSchema),
    manual: z.boolean(),
  }),
  scys: z.object({ enabled: z.boolean(), queries: z.array(z.string()) }),
  producthunt: z.object({ enabled: z.boolean(), limit: z.number().int().positive() }),
  github: z.object({ enabled: z.boolean(), queries: z.array(z.string()), limit: z.number().int().positive() }),
  xTimeline: z.object({ enabled: z.boolean(), handles: z.array(z.string()) }),
  redditFeed: z.object({ enabled: z.boolean(), communities: z.array(z.string()) }),
  googleTrends: z.object({ mode: z.literal("manual-or-optional"), region: z.string() }),
  report: z.object({ maxActionable: z.number().int().nonnegative(), maxWatch: z.number().int().nonnegative() }),
});

export const radarConfigSchema = radarConfigShape;

export type RadarConfig = z.infer<typeof radarConfigSchema>;

export type SourceContext = {
  workspaceRoot: string;
  fetchedAt: string;
  config: RadarConfig;
};

export type SourceCollection = {
  signals: RawSignal[];
  health: SourceHealth;
};

export type SourceAdapter = {
  name: SourceType;
  collect(context: SourceContext): Promise<SourceCollection>;
};
