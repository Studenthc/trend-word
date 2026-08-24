import { parseRawSignal, parseSourceHealth, type RawSignal, type SourceAdapter, type SourceCollection } from "../types.js";

export type HttpTransport = (request: {
  url: string;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
}) => Promise<{ status: number; headers: Headers; text(): Promise<string> }>;

export type GitHubAdapterOptions = { url?: string };

export function createGitHubAdapter(transport: HttpTransport, options: GitHubAdapterOptions = {}): SourceAdapter {
  return {
    name: "github",
    async collect(context): Promise<SourceCollection> {
      try {
        const response = await transport({ url: options.url ?? "https://api.github.com/search/repositories", method: "GET" });
        if (response.status === 403 || response.status === 429) return collection("blocked", context.fetchedAt, [], [`HTTP ${response.status} GitHub rate limit or forbidden`]);
        if (response.status < 200 || response.status >= 300) return collection("unverified", context.fetchedAt, [], [`HTTP ${response.status} GitHub response`]);
        const payload = JSON.parse(await response.text()) as unknown;
        const repositories = repositoryNodes(payload);
        if (!repositories) return collection("unverified", context.fetchedAt, [], ["GitHub repository parse failed: missing items"]);
        const signals = repositories.map((repository) => toSignal(repository, context.fetchedAt));
        return collection(signals.length === 0 ? "empty" : "available", context.fetchedAt, signals);
      } catch (error) {
        return collection("unverified", context.fetchedAt, [], [`GitHub JSON parse failed: ${message(error)}`]);
      }
    },
  };
}

export const githubAdapter = createGitHubAdapter;

function repositoryNodes(value: unknown): Record<string, unknown>[] | undefined {
  if (!record(value)) return undefined;
  if (Array.isArray(value.items)) return value.items.filter(record);
  if (Array.isArray(value.repositories)) return value.repositories.filter(record);
  return undefined;
}

function toSignal(repository: Record<string, unknown>, fetchedAt: string): RawSignal {
  const fullName = text(repository, "full_name") ?? text(repository, "name");
  const sourceUrl = text(repository, "html_url") ?? text(repository, "url");
  if (!fullName || !sourceUrl) throw new Error("repository missing full_name or html_url");
  const owner = record(repository.owner) ? repository.owner : undefined;
  const readme = text(repository, "readme_excerpt") ?? text(repository, "readme");
  return parseRawSignal({ id: `github-${fullName}`, sourceType: "github", sourceName: "GitHub", sourceUrl, externalId: fullName, title: fullName, body: text(repository, "description"), excerpt: readme, author: { name: owner ? text(owner, "login") ?? "Unknown owner" : "Unknown owner", ...(owner && text(owner, "id") ? { id: text(owner, "id") } : {}) }, publishedAt: text(repository, "created_at") ?? text(repository, "createdAt"), fetchedAt, sourceTier: "first_party", engagement: { ...(number(repository.stargazers_count) ?? number(repository.stars) !== undefined ? { stars: number(repository.stargazers_count) ?? number(repository.stars) } : {}) }, sourceFingerprint: `github:${fullName}`, evidenceStatus: "verified" });
}

function collection(status: "available" | "partial" | "blocked" | "empty" | "unverified", attemptedAt: string, signals: RawSignal[], failureReasons: string[] = [], coverageNotes: string[] = []): SourceCollection { return { signals, health: parseSourceHealth({ sourceType: "github", status, attemptedAt, itemCount: signals.length, failureReasons, coverageNotes }) }; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: Record<string, unknown>, key: string): string | undefined { return typeof value[key] === "string" && value[key].trim() ? value[key].trim() : undefined; }
function number(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
