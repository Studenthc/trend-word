import { appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export async function appendJsonl<T>(filePath: string, records: readonly T[]): Promise<void> {
  const lines = records.map((record) => `${JSON.stringify(record)}\n`).join("");
  if (lines.length === 0) return;

  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, lines, "utf8");
}

export async function readJsonl<T>(
  filePath: string,
  parse: (value: unknown) => T = (value) => value as T,
): Promise<T[]> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const records: T[] = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (line.trim() === "") continue;
    try {
      records.push(parse(JSON.parse(line)));
    } catch (error) {
      throw new Error(`Invalid JSONL at ${filePath}, line ${index + 1}`, { cause: error });
    }
  }
  return records;
}

export async function replaceJson<T>(filePath: string, value: T): Promise<void> {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError(`Cannot serialize JSON payload for ${filePath}`);
  }
  JSON.parse(serialized);

  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await writeFile(temporaryPath, serialized, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
