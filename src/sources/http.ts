export type HttpTransport = (request: {
  url: string;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
}) => Promise<{ status: number; headers: Headers; text(): Promise<string> }>;

export type HttpTransportOptions = {
  userAgent?: string;
  bearerEnv?: string;
};

export function createHttpTransport(options: HttpTransportOptions = {}): HttpTransport {
  return async (request) => {
    const headers: Record<string, string> = {
      "user-agent": options.userAgent ?? "trend-word-opportunity-radar/1.0",
      ...(request.headers ?? {}),
    };
    const bearer = options.bearerEnv ? process.env[options.bearerEnv]?.trim() : undefined;
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    const response = await fetch(request.url, { method: request.method ?? "GET", headers, ...(request.body ? { body: request.body } : {}) });
    return { status: response.status, headers: response.headers, text: () => response.text() };
  };
}

export function createProductHuntGraphqlTransport(options: { tokenEnv?: string } = {}): HttpTransport {
  const tokenEnv = options.tokenEnv ?? "PRODUCT_HUNT_API_TOKEN";
  return async (request) => {
    const token = process.env[tokenEnv]?.trim();
    if (!token) return { status: 401, headers: new Headers(), text: async () => "missing Product Hunt API token" };
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
    const first = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 20;
    const query = `query { posts(first: ${first}, order: NEWEST) { edges { node { id name tagline url createdAt votesCount commentsCount user { id name url } } } } }`;
    const response = await fetch("https://api.producthunt.com/v2/api/graphql", { method: "POST", headers: { "content-type": "application/json", "user-agent": "trend-word-opportunity-radar/1.0", authorization: `Bearer ${token}` }, body: JSON.stringify({ query }) });
    return { status: response.status, headers: response.headers, text: () => response.text() };
  };
}

export function createXApiTransport(options: { tokenEnv?: string } = {}): HttpTransport {
  const tokenEnv = options.tokenEnv ?? "X_BEARER_TOKEN";
  return async (request) => {
    const token = process.env[tokenEnv]?.trim();
    if (!token) return { status: 401, headers: new Headers(), text: async () => "missing X bearer token" };
    const handle = request.url.match(/\/timeline\/([^/]+)\/tweets$/u)?.[1];
    if (!handle) return { status: 400, headers: new Headers(), text: async () => "invalid X timeline URL" };
    const headers = { authorization: `Bearer ${token}`, "user-agent": "trend-word-opportunity-radar/1.0" };
    const user = await fetch(`https://api.twitter.com/2/users/by/username/${encodeURIComponent(handle)}`, { headers });
    if (!user.ok) return { status: user.status, headers: user.headers, text: () => user.text() };
    const payload = await user.json() as { data?: { id?: string } };
    if (!payload.data?.id) return { status: 404, headers: user.headers, text: async () => "X user not found" };
    const timeline = await fetch(`https://api.twitter.com/2/users/${encodeURIComponent(payload.data.id)}/tweets?max_results=100&tweet.fields=created_at,public_metrics`, { headers });
    return { status: timeline.status, headers: timeline.headers, text: () => timeline.text() };
  };
}

export function createRedditFallbackTransport(options: { userAgent?: string; tokenEnv?: string } = {}): HttpTransport {
  return async (request) => {
    const token = process.env[options.tokenEnv ?? "REDDIT_ACCESS_TOKEN"]?.trim();
    const headers = { "user-agent": options.userAgent ?? "trend-word-opportunity-radar/1.0", ...(token ? { authorization: `Bearer ${token}` } : {}) };
    const primary = token ? request.url.replace("www.reddit.com", "oauth.reddit.com") : request.url;
    const urls = [primary, request.url.replace("www.reddit.com", "old.reddit.com").replace(/\/new\.json(?=$|\?)/u, "/new/.rss"), request.url.replace(/\/new\.json(?=$|\?)/u, "/new/.rss")];
    let response = await fetch(urls[0]!, { method: request.method ?? "GET", headers });
    for (const url of urls.slice(1)) {
      if (![403, 429].includes(response.status)) break;
      response = await fetch(url, { method: request.method ?? "GET", headers });
    }
    return { status: response.status, headers: response.headers, text: () => response.text() };
  };
}
