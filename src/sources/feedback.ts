import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseRawSignal, type RawSignal } from "../types.js";

export type FeedbackTransport = (request: {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}) => Promise<{ status: number; headers: Headers; text(): Promise<string> }>;

export type FeedbackResult = {
  status: "success" | "empty" | "unavailable" | "failed";
  signals: RawSignal[];
  errorCode?: string;
};

export type FeedbackEnrichmentResult = {
  sourceType: "github" | "producthunt";
  parentSignalId: string;
  result: FeedbackResult;
};

type FeedbackCacheEntry = FeedbackResult & { fetchedAt: string };
type FeedbackCache = Record<string, FeedbackCacheEntry>;

export async function fetchEntityFeedback(signal: RawSignal, transport: FeedbackTransport, fetchedAt: string): Promise<FeedbackResult> {
  if (signal.sourceType === "github") return fetchGitHubIssues(signal, transport, fetchedAt);
  if (signal.sourceType === "producthunt") return fetchProductHuntComments(signal, transport, fetchedAt);
  return { status: "failed", signals: [], errorCode: "feedback_source_unsupported" };
}

export async function enrichSignalsWithFeedback(
  signals: RawSignal[],
  transports: { github?: FeedbackTransport; producthunt?: FeedbackTransport },
  workspaceRoot: string,
  fetchedAt: string,
  limit = 20,
): Promise<{ signals: RawSignal[]; results: FeedbackEnrichmentResult[] }> {
  const cachePath = path.join(workspaceRoot, "data", "cache", "entity-feedback.json");
  const cache = await readCache(cachePath);
  const entityGroups = ["github", "producthunt"].map((sourceType) => signals.filter((signal) => signal.sourceType === sourceType && signal.signalKind !== "feedback")).filter((group) => group.length > 0);
  if (entityGroups.length === 0 || (!transports.github && !transports.producthunt)) return { signals: [...signals], results: [] };
  const perSourceLimit = Math.max(1, Math.floor(limit / Math.max(entityGroups.length, 1)));
  const entities = entityGroups.flatMap((group) => group.slice(0, perSourceLimit)).slice(0, limit);
  const enriched = [...signals];
  const results: FeedbackEnrichmentResult[] = [];
  for (const signal of entities) {
    const sourceType = signal.sourceType as "github" | "producthunt";
    const key = feedbackKey(signal);
    const cached = cache[key];
    let result: FeedbackResult | undefined = cached && sameRun(cached.fetchedAt, fetchedAt) ? cached : undefined;
    if (!result) {
      const transport = transports[sourceType];
      result = transport ? await fetchEntityFeedback(signal, transport, fetchedAt) : { status: "unavailable", signals: [], errorCode: "feedback_transport_missing" };
      cache[key] = { ...result, fetchedAt };
    }
    results.push({ sourceType, parentSignalId: signal.id, result });
    enriched.push(...result.signals);
  }
  await writeCache(cachePath, cache);
  return { signals: enriched, results };
}

export function isFeedbackSignal(signal: RawSignal): boolean {
  return signal.signalKind === "feedback" || signal.tags?.includes("feedback") === true;
}

async function fetchGitHubIssues(signal: RawSignal, transport: FeedbackTransport, fetchedAt: string): Promise<FeedbackResult> {
  if (!allowedSourceUrl(signal.sourceUrl, "github.com") || !signal.externalId || !/^[^/\s]+\/[^/\s]+$/u.test(signal.externalId)) return { status: "failed", signals: [], errorCode: "feedback_url_not_allowed" };
  const url = `https://api.github.com/repos/${signal.externalId}/issues?state=open&sort=created&direction=desc&per_page=5`;
  try {
    const response = await transport({ url, method: "GET" });
    if ([401, 403, 404, 429].includes(response.status)) return { status: "unavailable", signals: [], errorCode: `github_feedback_http_${response.status}` };
    if (response.status < 200 || response.status >= 300) return { status: "failed", signals: [], errorCode: `github_feedback_http_${response.status}` };
    const payload = JSON.parse(await response.text()) as unknown;
    if (!Array.isArray(payload)) return { status: "failed", signals: [], errorCode: "github_feedback_parse_failed" };
    const feedback = payload.filter(isRecord).filter((issue) => !isRecord(issue.pull_request)).map((issue, index) => toGitHubIssueSignal(signal, issue, fetchedAt, index));
    return feedback.length > 0 ? { status: "success", signals: feedback } : { status: "empty", signals: [] };
  } catch {
    return { status: "failed", signals: [], errorCode: "github_feedback_network_or_json" };
  }
}

async function fetchProductHuntComments(signal: RawSignal, transport: FeedbackTransport, fetchedAt: string): Promise<FeedbackResult> {
  if (!allowedSourceUrl(signal.sourceUrl, "producthunt.com") || !signal.externalId || !/^[-\w]+$/u.test(signal.externalId)) return { status: "failed", signals: [], errorCode: "feedback_url_not_allowed" };
  const query = "query PostComments($id: ID!, $first: Int!) { post(id: $id) { comments(first: $first) { edges { node { id body createdAt user { id name } } } } } }";
  try {
    const response = await transport({ url: "https://api.producthunt.com/v2/api/graphql", method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables: { id: signal.externalId, first: 10 } }) });
    if ([401, 403, 404, 429].includes(response.status)) return { status: "unavailable", signals: [], errorCode: `producthunt_feedback_http_${response.status}` };
    if (response.status < 200 || response.status >= 300) return { status: "failed", signals: [], errorCode: `producthunt_feedback_http_${response.status}` };
    const payload = JSON.parse(await response.text()) as unknown;
    if (!isRecord(payload) || Array.isArray(payload.errors)) return { status: "unavailable", signals: [], errorCode: "producthunt_comments_unavailable" };
    const post = isRecord(payload.data) && isRecord(payload.data.post) ? payload.data.post : undefined;
    const comments = post && isRecord(post.comments) && Array.isArray(post.comments.edges) ? post.comments.edges : undefined;
    if (!comments) return { status: "unavailable", signals: [], errorCode: "producthunt_comments_parse_failed" };
    const feedback = comments.filter(isRecord).map((edge, index) => isRecord(edge.node) ? toProductHuntCommentSignal(signal, edge.node, fetchedAt, index) : undefined).filter((item): item is RawSignal => Boolean(item));
    return feedback.length > 0 ? { status: "success", signals: feedback } : { status: "empty", signals: [] };
  } catch {
    return { status: "failed", signals: [], errorCode: "producthunt_feedback_network_or_json" };
  }
}

function toGitHubIssueSignal(parent: RawSignal, issue: Record<string, unknown>, fetchedAt: string, index: number): RawSignal {
  const numberValue = typeof issue.number === "number" || typeof issue.number === "string" ? String(issue.number) : String(index + 1);
  const title = text(issue, "title") ?? "GitHub issue";
  const sourceUrl = text(issue, "html_url") ?? `${parent.sourceUrl}/issues/${numberValue}`;
  const body = text(issue, "body") ?? title;
  const user = isRecord(issue.user) ? issue.user : undefined;
  return parseRawSignal({
    id: `github-issue-${parent.externalId ?? parent.id}-${numberValue}`,
    sourceType: "github", sourceName: "GitHub Issues", sourceUrl, externalId: `${parent.externalId ?? parent.id}#${numberValue}`,
    title, body, parentSignalId: parent.id, signalKind: "feedback", tags: ["feedback", "github-issue"],
    author: { name: user ? text(user, "login") ?? "GitHub user" : "GitHub user", ...(user && (typeof user.id === "number" || typeof user.id === "string") ? { id: String(user.id) } : {}) },
    publishedAt: text(issue, "created_at") ?? fetchedAt, fetchedAt, sourceTier: "community", sourceFingerprint: `github:issue:${parent.externalId ?? parent.id}#${numberValue}`, evidenceStatus: "verified",
  });
}

function toProductHuntCommentSignal(parent: RawSignal, comment: Record<string, unknown>, fetchedAt: string, index: number): RawSignal | undefined {
  const id = text(comment, "id");
  const body = text(comment, "body");
  if (!id || !body) return undefined;
  const user = isRecord(comment.user) ? comment.user : undefined;
  return parseRawSignal({
    id: `producthunt-comment-${parent.externalId ?? parent.id}-${id}`,
    sourceType: "producthunt", sourceName: "Product Hunt comments", sourceUrl: parent.sourceUrl, externalId: `${parent.externalId ?? parent.id}#${id}`,
    title: `Comment on ${parent.title ?? "Product Hunt launch"}`, body, parentSignalId: parent.id, signalKind: "feedback", tags: ["feedback", "producthunt-comment"],
    author: { name: user ? text(user, "name") ?? "Product Hunt user" : "Product Hunt user", ...(user && (typeof user.id === "number" || typeof user.id === "string") ? { id: String(user.id) } : {}) },
    publishedAt: text(comment, "createdAt") ?? fetchedAt, fetchedAt, sourceTier: "community", sourceFingerprint: `producthunt:comment:${parent.externalId ?? parent.id}#${id}:${index}`, evidenceStatus: "verified",
  });
}

function feedbackKey(signal: RawSignal): string { return `${signal.sourceType}:${signal.externalId ?? signal.sourceUrl}`; }

async function readCache(filePath: string): Promise<FeedbackCache> {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (!isRecord(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => isRecord(entry) && typeof entry.fetchedAt === "string" && Array.isArray(entry.signals) && typeof entry.status === "string")) as FeedbackCache;
  } catch { return {}; }
}

async function writeCache(filePath: string, cache: FeedbackCache): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(cache), "utf8");
  await rename(temp, filePath);
}

function allowedSourceUrl(value: string, hostname: string): boolean {
  try { const parsed = new URL(value); return parsed.protocol === "https:" && (parsed.hostname === hostname || parsed.hostname === `www.${hostname}`); } catch { return false; }
}
function sameRun(left: string, right: string): boolean { return left.slice(0, 10) === right.slice(0, 10); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: Record<string, unknown>, key: string): string | undefined { return typeof value[key] === "string" && value[key].trim() ? value[key].trim() : undefined; }
