import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  evidenceSchema,
  expressionSchema,
  opportunitySchema,
  parseRawSignal,
  parseRunSummary,
  discoverySummarySchema,
  seedTermSchema,
  expressionClusterSchema,
  demandExpressionSchema,
  modelCapabilitySchema,
  modelCombinationSchema,
  modelRecordSchema,
  keywordModelMappingSchema,
  trendVerificationSchema,
  type RawSignal,
  type Expression,
  type DiscoverySummary,
  type TrendVerification,
} from "../types.js";
import { appendJsonl, readJsonl, replaceJson } from "./jsonl.js";

type ProjectionName = "expressions" | "opportunities" | "evidence" | "run-summary" | "discovery-summary" | "seed-terms" | "expression-clusters" | "demand-expressions" | "trend-verifications" | "model-inventory" | "capabilities" | "keyword-model-mapping" | "model-combinations";
type ImportName = "opportunities" | "evidence";
type Validator = (value: unknown) => unknown;

const projectionValidators: Record<ProjectionName, Validator> = {
  expressions: (value) => expressionSchema.array().parse(value),
  opportunities: (value) => opportunitySchema.array().parse(value),
  evidence: (value) => evidenceSchema.array().parse(value),
  "run-summary": parseRunSummary,
  "discovery-summary": (value) => discoverySummarySchema.parse(value),
  "seed-terms": (value) => seedTermSchema.array().parse(value),
  "expression-clusters": (value) => expressionClusterSchema.array().parse(value),
  "demand-expressions": (value) => demandExpressionSchema.array().parse(value),
  "trend-verifications": (value) => trendVerificationSchema.array().parse(value),
  "model-inventory": (value) => modelRecordSchema.array().parse(value),
  capabilities: (value) => modelCapabilitySchema.array().parse(value),
  "keyword-model-mapping": (value) => keywordModelMappingSchema.array().parse(value),
  "model-combinations": (value) => modelCombinationSchema.array().parse(value),
};

const historyValidator: Validator = (value) => opportunitySchema.array().parse(value);
const expressionHistoryValidator: Validator = (value) => expressionSchema.array().parse(value);
const importRecordValidators: Record<ImportName, Validator> = {
  opportunities: (value) => opportunitySchema.parse(value),
  evidence: (value) => evidenceSchema.parse(value),
};

function validateRunDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new RangeError(`Invalid run date: ${date}`);
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new RangeError(`Invalid run date: ${date}`);
  }
  return date;
}

export class RunStore {
  readonly runDirectory: string;
  private readonly rawSignalsPath: string;
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string, date = new Date().toISOString().slice(0, 10)) {
    validateRunDate(date);
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
    await replaceJson(this.projectionPath(name), projectionValidators[name](value));
  }

  async readProjection<T>(name: ProjectionName): Promise<T | undefined> {
    try {
      return projectionValidators[name](JSON.parse(await readFile(this.projectionPath(name), "utf8"))) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async writeDiscoverySummary(value: DiscoverySummary): Promise<void> {
    await this.writeProjection("discovery-summary", value);
  }

  async appendTrendVerification(value: TrendVerification): Promise<void> {
    const current = await this.readProjection<TrendVerification[]>("trend-verifications") ?? [];
    await this.writeProjection("trend-verifications", [...current, trendVerificationSchema.parse(value)]);
  }

  async importJsonl(name: ImportName, content: string): Promise<void> {
    const records = await this.parseContent(name, content);
    await replaceJson(this.projectionPath(name), projectionValidators[name](records));
  }

  async writeHistory(value: unknown): Promise<void> {
    await replaceJson(
      path.join(this.workspaceRoot, "data", "history", "opportunities.json"),
      historyValidator(value),
    );
  }

  async readHistory<T>(): Promise<T | undefined> {
    try {
      return historyValidator(JSON.parse(
        await readFile(path.join(this.workspaceRoot, "data", "history", "opportunities.json"), "utf8"),
      )) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async writeHistoryExpressions(value: Expression[]): Promise<void> {
    await replaceJson(
      path.join(this.workspaceRoot, "data", "history", "expressions.json"),
      expressionHistoryValidator(value),
    );
  }

  async readHistoryExpressions(): Promise<Expression[]> {
    try {
      return expressionHistoryValidator(JSON.parse(
        await readFile(path.join(this.workspaceRoot, "data", "history", "expressions.json"), "utf8"),
      )) as Expression[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private projectionPath(name: ProjectionName): string {
    return path.join(this.runDirectory, `${name}.json`);
  }

  private async parseContent(name: ImportName, content: string): Promise<unknown[]> {
    const records: unknown[] = [];
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      if (line.trim() === "") continue;
      try {
        records.push(importRecordValidators[name](JSON.parse(line)));
      } catch (error) {
        const issue = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid ${name} JSONL at line ${index + 1}: ${issue}`, { cause: error });
      }
    }
    return records;
  }
}
