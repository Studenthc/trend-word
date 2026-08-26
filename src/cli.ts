import { runRadar, type RadarRunOptions } from "./index.js";
import { appendCandidateFeedback } from "./storage/feedback-store.js";
import { RunStore } from "./storage/run-store.js";

export function parseCliArgs(args: string[]): RadarRunOptions {
  if (args[0] === "--") args = args.slice(1);
  let date: string | undefined;
  let sourceNames: string[] | undefined;
  let inputPath: string | undefined;
  let workspaceRoot: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag?.startsWith("--")) throw usageError(`unexpected argument ${flag ?? ""}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw usageError(`${flag} requires a value`);
    if (flag === "--date") date = value;
    else if (flag === "--sources") sourceNames = value.split(",").map((item) => item.trim()).filter(Boolean);
    else if (flag === "--input") inputPath = value;
    else if (flag === "--workspace") workspaceRoot = value;
    else throw usageError(`unknown flag ${flag}`);
    index += 1;
  }
  return { date: date ?? new Date().toISOString().slice(0, 10), ...(sourceNames ? { sourceNames } : {}), ...(inputPath ? { inputPath } : {}), ...(workspaceRoot ? { workspaceRoot } : {}) };
}

function usageError(message: string): Error {
  return new Error(`Usage: radar [--date YYYY-MM-DD] [--sources fixtures,manual] [--input path] [--workspace path]: ${message}`);
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    if (args[0] === "feedback") return await feedbackMain(args.slice(1));
    if (args[0] === "verify") return await verifyMain(args.slice(1));
    const result = await runRadar(parseCliArgs(args));
    process.stdout.write(`${result.paths.report}\n${result.report}`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    return /Usage:/.test(message) ? 2 : 1;
  }
}

async function verifyMain(args: string[]): Promise<number> {
  let candidateId: string | undefined;
  let result: "rising" | "flat" | "declining" | "breakout" | "no_data" | undefined;
  let region = "CN";
  let note: string | undefined;
  let date = new Date().toISOString().slice(0, 10);
  let workspaceRoot = process.cwd();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw usageError(`${flag ?? "verify flag"} requires a value`);
    if (flag === "--candidate") candidateId = value;
    else if (flag === "--result" && ["rising", "flat", "declining", "breakout", "no_data"].includes(value)) result = value as typeof result;
    else if (flag === "--region") region = value;
    else if (flag === "--note") note = value;
    else if (flag === "--date") date = value;
    else if (flag === "--workspace") workspaceRoot = value;
    else throw usageError(`unknown flag ${flag}`);
    index += 1;
  }
  if (!candidateId || !result) throw usageError("verify requires --candidate and --result rising|flat|declining|breakout|no_data");
  const store = new RunStore(workspaceRoot, date);
  await store.appendTrendVerification({ candidateId, provider: "google_trends_manual", checkedAt: new Date().toISOString(), window: "7d", region, result, relatedQueries: [], ...(note ? { notes: note } : {}) });
  process.stdout.write(`trend verification recorded: ${candidateId} -> ${result}\n`);
  return 0;
}

async function feedbackMain(args: string[]): Promise<number> {
  let candidateId: string | undefined;
  let decision: "keep" | "skip" | "false_positive" | undefined;
  let reason: string | undefined;
  let workspaceRoot = process.cwd();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw usageError(`${flag ?? "feedback flag"} requires a value`);
    if (flag === "--candidate") candidateId = value;
    else if (flag === "--decision" && (value === "keep" || value === "skip" || value === "false_positive")) decision = value;
    else if (flag === "--reason") reason = value;
    else if (flag === "--workspace") workspaceRoot = value;
    else throw usageError(`unknown feedback flag ${flag}`);
    index += 1;
  }
  if (!candidateId || !decision) throw usageError("feedback requires --candidate and --decision keep|skip|false_positive");
  await appendCandidateFeedback(workspaceRoot, { candidateId, decision, ...(reason ? { reason } : {}), recordedAt: new Date().toISOString() });
  process.stdout.write(`feedback recorded: ${candidateId} -> ${decision}\n`);
  return 0;
}

if (process.argv[1]?.endsWith("/src/cli.ts")) {
  main().then((code) => { process.exitCode = code; });
}
