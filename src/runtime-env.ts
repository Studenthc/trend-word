import { execFileSync } from "node:child_process";

const ALLOWED_LAUNCHD_VARIABLES = ["PRODUCT_HUNT_API_TOKEN", "RADAR_GITHUB_TOKEN", "RADAR_ENABLE_PUBLIC_HTTP"] as const;
type EnvironmentGetter = (name: string) => string | undefined;

export function inheritLaunchdEnvironment(target: NodeJS.ProcessEnv = process.env, getter: EnvironmentGetter = launchdValue): void {
  for (const name of ALLOWED_LAUNCHD_VARIABLES) {
    if (target[name]?.trim()) continue;
    const value = getter(name)?.trim();
    if (value) target[name] = value;
  }
}

function launchdValue(name: string): string | undefined {
  if (process.platform !== "darwin") return undefined;
  try { return execFileSync("launchctl", ["getenv", name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return undefined; }
}
