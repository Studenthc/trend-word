import { parseRawSignal, parseSourceHealth, type RawSignal, type SourceAdapter, type SourceCollection } from "../types.js";
import { dedupeRawSignals } from "../domain/dedupe.js";

export type HttpTransport = (request: {
  url: string;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
}) => Promise<{ status: number; headers: Headers; text(): Promise<string> }>;

export type GitHubAdapterOptions = { url?: string; queries?: string[]; limit?: number };

export function createGitHubAdapter(transport: HttpTransport, options: GitHubAdapterOptions = {}): SourceAdapter {
  return {
    name: "github",
    async collect(context): Promise<SourceCollection> {
      const queries = options.queries?.length ? options.queries : [undefined];
      const signals: RawSignal[] = [];
      const failures: string[] = [];
      const failureStatuses: number[] = [];
      let successfulQueries = 0;
      for (const query of queries) {
        try {
          const baseUrl = options.url ?? "https://api.github.com/search/repositories";
          const params = new URLSearchParams();
          if (query) params.set("q", query);
          if (options.limit) params.set("per_page", String(options.limit));
          const queryString = params.toString();
          const response = await transport({ url: `${baseUrl}${queryString ? `?${queryString}` : ""}`, method: "GET" });
          if ([401, 403, 404, 429].includes(response.status)) throw Object.assign(new Error(`HTTP ${response.status} GitHub rate limit or forbidden`), { status: response.status });
          if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status} GitHub response`);
          const payload = JSON.parse(await response.text()) as unknown;
          const repositories = repositoryNodes(payload);
          if (!repositories) throw new Error("GitHub repository parse failed: missing items");
          successfulQueries += 1;
          for (const repository of repositories) {
            try {
              signals.push(toSignal(repository, context.fetchedAt));
            } catch (error) {
              failures.push(`GitHub query ${query ?? "default"} item failed: ${message(error)}`);
            }
          }
        } catch (error) {
          const status = errorStatus(error);
          if (status !== undefined) failureStatuses.push(status);
          failures.push(`GitHub query ${query ?? "default"} failed: ${message(error)}`);
        }
      }
      const dedupedSignals = dedupeRawSignals(signals);
      if (dedupedSignals.length > 0) return collection(failures.length > 0 ? "partial" : "available", context.fetchedAt, dedupedSignals, failures);
      if (failures.length > 0 && successfulQueries > 0) return collection("partial", context.fetchedAt, [], failures);
      if (failures.length > 0) return collection(failureStatuses.some((status) => [401, 403, 404, 429].includes(status)) ? "blocked" : "unverified", context.fetchedAt, [], failures);
      return collection("empty", context.fetchedAt, []);
    },
  };
}

export const githubAdapter = createGitHubAdapter;

function repositoryNodes(value: unknown): Record<string, unknown>[] | undefined {
  if (!record(value)) return undefined;
  if (Array.isArray(value.items)) {
    if (value.items.some((item) => !record(item))) throw new Error("malformed repository item");
    return value.items as Record<string, unknown>[];
  }
  if (Array.isArray(value.repositories)) {
    if (value.repositories.some((item) => !record(item))) throw new Error("malformed repository item");
    return value.repositories as Record<string, unknown>[];
  }
  return undefined;
}

function toSignal(repository: Record<string, unknown>, fetchedAt: string): RawSignal {
  const fullName = text(repository, "full_name") ?? text(repository, "name");
  const sourceUrl = text(repository, "html_url") ?? text(repository, "url");
  if (!fullName || !sourceUrl) throw new Error("repository missing full_name or html_url");
  const owner = record(repository.owner) ? repository.owner : undefined;
  const readme = text(repository, "readme_excerpt") ?? text(repository, "readme");
  return parseRawSignal({ id: `github-${fullName}`, sourceType: "github", sourceName: "GitHub", sourceUrl, externalId: fullName, title: fullName, body: text(repository, "description"), excerpt: readme, author: { name: owner ? text(owner, "login") ?? "Unknown owner" : "Unknown owner", ...(owner && text(owner, "id") ? { id: text(owner, "id") } : {}) }, publishedAt: text(repository, "created_at") ?? text(repository, "createdAt"), fetchedAt, language: text(repository, "language"), sourceTier: "first_party", engagement: { ...(number(repository.stargazers_count) ?? number(repository.stars) !== undefined ? { stars: number(repository.stargazers_count) ?? number(repository.stars) } : {}) }, sourceFingerprint: `github:${fullName}`, evidenceStatus: "verified" });
}

function collection(status: "available" | "partial" | "blocked" | "empty" | "unverified", attemptedAt: string, signals: RawSignal[], failureReasons: string[] = [], coverageNotes: string[] = []): SourceCollection { return { signals, health: parseSourceHealth({ sourceType: "github", status, attemptedAt, itemCount: signals.length, failureReasons, coverageNotes }) }; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: Record<string, unknown>, key: string): string | undefined { return typeof value[key] === "string" && value[key].trim() ? value[key].trim() : undefined; }
function number(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function errorStatus(error: unknown): number | undefined { return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : undefined; }
