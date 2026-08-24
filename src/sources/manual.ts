import { parseRawSignal, sourceTypeSchema, type AuthorRef, type RawSignal, type SourceType } from "../types.js";

export type ManualFormat = "jsonl" | "csv";

export type ManualImportOptions = {
  format?: ManualFormat;
  previous?: RawSignal[];
  fetchedAt?: string;
  sourceName?: string;
};

export type ManualRowError = { row: number; message: string };
export type ManualImportResult = { signals: RawSignal[]; errors: ManualRowError[] };

type ManualRecord = Record<string, unknown>;

export function importManualSignals(input: string, options: ManualImportOptions = {}): ManualImportResult {
  const format = options.format ?? inferFormat(input);
  const rows = format === "csv" ? parseCsv(input) : parseJsonl(input);
  const signals: RawSignal[] = [...(options.previous ?? [])];
  const errors: ManualRowError[] = [];
  for (const row of rows) {
    try {
      const signal = toRawSignal(row.value, row.row, options);
      parseRawSignal(signal);
      signals.push(signal);
    } catch (error) {
      errors.push({ row: row.row, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { signals, errors };
}

export const parseManualSignals = importManualSignals;

function inferFormat(input: string): ManualFormat {
  const firstLine = input.split(/\r?\n/u).find((line) => line.trim())?.trim() ?? "";
  return firstLine.startsWith("{") ? "jsonl" : "csv";
}

function parseJsonl(input: string): Array<{ row: number; value: unknown }> {
  return input.split(/\r?\n/u).flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      return [{ row: index + 1, value: JSON.parse(line) as unknown }];
    } catch (error) {
      return [{ row: index + 1, value: { __parseError: error instanceof Error ? error.message : String(error) } }];
    }
  });
}

function parseCsv(input: string): Array<{ row: number; value: unknown }> {
  const records: Array<{ row: number; values: string[] }> = [];
  let row = 1;
  let field = "";
  let fields: string[] = [];
  let quoted = false;
  let startRow = 1;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (character === '"') {
      if (quoted && input[index + 1] === '"') { field += '"'; index += 1; } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      fields.push(field); field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      fields.push(field); records.push({ row: startRow, values: fields });
      row += 1; startRow = row; field = ""; fields = [];
    } else {
      field += character;
    }
  }
  if (field || fields.length > 0) { fields.push(field); records.push({ row: startRow, values: fields }); }
  const header = records.shift();
  if (!header) return [];
  return records.map((record) => ({ row: record.row, value: Object.fromEntries(header.values.map((key, index) => [key.trim(), record.values[index] ?? ""])) }));
}

function toRawSignal(value: unknown, row: number, options: ManualImportOptions): RawSignal {
  if (!isRecord(value) || "__parseError" in value) throw new Error(`invalid row: ${isRecord(value) && typeof value.__parseError === "string" ? value.__parseError : "expected object"}`);
  const sourceUrl = text(value, ["sourceUrl", "source_url", "url"]);
  if (!sourceUrl) throw new Error("missing sourceUrl");
  const title = text(value, ["title", "name", "headline"]);
  const body = text(value, ["body", "description", "content", "text"]);
  if (!title && !body) throw new Error("missing title or body");
  const sourceTypeValue = text(value, ["sourceType", "source_type"]) ?? "manual";
  const parsedSourceType = sourceTypeSchema.safeParse(sourceTypeValue);
  if (!parsedSourceType.success) throw new Error(`invalid sourceType ${sourceTypeValue}`);
  const sourceType: SourceType = parsedSourceType.data;
  const author = toAuthor(value.author ?? value.authorName);
  const fetchedAt = text(value, ["fetchedAt", "fetched_at"]) ?? options.fetchedAt ?? new Date().toISOString();
  const externalId = text(value, ["externalId", "external_id"]);
  const id = text(value, ["id"]) ?? `manual-${row}`;
  const sourceName = text(value, ["sourceName", "source_name"]) ?? options.sourceName ?? "Manual import";
  const sourceFingerprint = text(value, ["sourceFingerprint", "source_fingerprint"]) ?? `manual:${sourceType}:${sourceUrl}:${externalId ?? title ?? body}`;
  return {
    id, sourceType, sourceName, sourceUrl, ...(externalId ? { externalId } : {}),
    ...(title ? { title } : {}), ...(body ? { body } : {}), ...(text(value, ["excerpt"]) ? { excerpt: text(value, ["excerpt"]) } : {}),
    ...(author ? { author } : {}),
    ...(text(value, ["publishedAt", "published_at", "published"]) ? { publishedAt: text(value, ["publishedAt", "published_at", "published"]) } : {}),
    fetchedAt, sourceTier: "community", sourceFingerprint, evidenceStatus: "verified",
  };
}

function toAuthor(value: unknown): AuthorRef | undefined {
  if (typeof value === "string" && value.trim()) return { name: value.trim() };
  if (isRecord(value) && typeof value.name === "string" && value.name.trim()) return { name: value.name.trim(), ...(typeof value.id === "string" ? { id: value.id } : {}) };
  return undefined;
}

function text(record: ManualRecord, keys: string[]): string | undefined {
  for (const key of keys) if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  return undefined;
}

function isRecord(value: unknown): value is ManualRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
