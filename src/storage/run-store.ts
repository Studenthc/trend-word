import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseRawSignal, type RawSignal } from "../types.js";
import { appendJsonl, readJsonl, replaceJson } from "./jsonl.js";

type ProjectionName = "expressions" | "opportunities" | "evidence" | "run-summary";
type ImportName = "opportunities" | "evidence";

export class RunStore {
  readonly runDirectory: string;
  private readonly rawSignalsPath: string;
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string, date = new Date().toISOString().slice(0, 10)) {
    this.workspaceRoot = workspaceRoot;
    this.runDirectory = path.join(workspaceRoot, "data", "runs", date);
    this.rawSignalsPath = path.join(this.runDirectory, "raw-signals.jsonl");
  }

  async appendRawSignals(signals: RawSignal[]): Promise<void> {
    const validated = signals.map(parseRawSignal);
    await appendJsonl(this.rawSignalsPath, validated);
  }

  async readRawSignals(): Promise<RawSignal[]> {
    return readJsonl(this.rawSignalsPath, parseRawSignal);
  }

  async writeProjection(name: ProjectionName, value: unknown): Promise<void> {
    await replaceJson(this.projectionPath(name), value);
  }

  async readProjection<T>(name: ProjectionName): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(this.projectionPath(name), "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async importJsonl(name: ImportName, content: string): Promise<void> {
    const temporaryPath = path.join(this.runDirectory, `.${name}.import-${process.pid}-${Date.now()}.jsonl`);
    const records = await this.parseContent(content, temporaryPath);
    await replaceJson(this.projectionPath(name), records);
  }

  async writeHistory(value: unknown): Promise<void> {
    await replaceJson(path.join(this.workspaceRoot, "data", "history", "opportunities.json"), value);
  }

  private projectionPath(name: ProjectionName): string {
    return path.join(this.runDirectory, `${name}.json`);
  }

  private async parseContent(content: string, filePath: string): Promise<unknown[]> {
    const records: unknown[] = [];
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      if (line.trim() === "") continue;
      try {
        records.push(JSON.parse(line));
      } catch (error) {
        throw new Error(`Invalid JSONL at ${filePath}, line ${index + 1}`, { cause: error });
      }
    }
    return records;
  }
}
