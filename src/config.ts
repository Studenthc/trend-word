import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const sourceTypeSchema = z.enum([
  "scys-mcp",
  "producthunt",
  "github",
  "x-timeline",
  "reddit-feed",
  "google-trends",
  "manual",
  "fixtures",
]);

const sourceHealthStatusSchema = z.enum(["available", "partial", "blocked", "empty", "unverified"]);

const configSchema = z.object({
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
  sourceHealthStatus: sourceHealthStatusSchema.optional(),
});

export type RadarConfig = z.infer<typeof configSchema>;

export type LoadConfigOptions = {
  workspaceRoot: string;
  configPath?: string;
  overrides?: unknown;
};

const defaults: RadarConfig = {
  sources: {
    required: ["scys-mcp", "producthunt", "github"],
    bestEffort: ["x-timeline", "reddit-feed"],
    manual: true,
  },
  scys: { enabled: true, queries: ["AI", "出海", "风向标"] },
  producthunt: { enabled: true, limit: 50 },
  github: { enabled: true, queries: ["ai tool", "mcp", "agent"], limit: 30 },
  xTimeline: { enabled: false, handles: [] },
  redditFeed: { enabled: false, communities: [] },
  googleTrends: { mode: "manual-or-optional", region: "US" },
  report: { maxActionable: 5, maxWatch: 20 },
};

function mergeConfig(base: unknown, override: unknown): unknown {
  if (!isRecord(base) || !isRecord(override)) return override;

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = key in merged ? mergeConfig(merged[key], value) : value;
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readOptionalJson(filePath: string): Promise<unknown> {
  try {
    await access(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

export async function loadConfig(options: LoadConfigOptions): Promise<RadarConfig> {
  const filePath = options.configPath ?? path.join(options.workspaceRoot, "radar.config.json");
  const fileConfig = await readOptionalJson(filePath);
  return configSchema.parse(mergeConfig(mergeConfig(defaults, fileConfig), options.overrides ?? {}));
}
