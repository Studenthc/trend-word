import { readFile } from "node:fs/promises";
import path from "node:path";
import { radarConfigSchema, type RadarConfig } from "./types.js";

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
  scys: { enabled: true, queries: ["AI", "带货", "视频号"] },
  discovery: { recentDays: 7, maxSourcesPerQuery: 3 },
  producthunt: { enabled: true, limit: 50 },
  github: { enabled: true, queries: ["ai tool", "mcp", "agent"], limit: 30 },
  xTimeline: { enabled: false, handles: [] },
  redditFeed: { enabled: false, communities: [] },
  googleTrends: { mode: "manual-or-optional", region: "US" },
  report: { maxActionable: 5, maxWatch: 20, maxVerificationItems: 10 },
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
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function loadConfig(options: LoadConfigOptions): Promise<RadarConfig> {
  const filePath = options.configPath ?? path.join(options.workspaceRoot, "radar.config.json");
  const fileConfig = await readOptionalJson(filePath);
  return radarConfigSchema.parse(mergeConfig(mergeConfig(defaults, fileConfig), options.overrides ?? {}));
}
