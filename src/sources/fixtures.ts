import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseRawSignal, type RawSignal } from "../types.js";

const fixturePath = fileURLToPath(new URL("../../fixtures/sample-signals.jsonl", import.meta.url));

export async function loadFixtureSignals(): Promise<RawSignal[]> {
  const lines = (await readFile(fixturePath, "utf8")).split(/\r?\n/u).filter((line) => line.trim());
  return lines.map((line) => parseRawSignal(JSON.parse(line) as unknown));
}

export type MixedFixtureCorpus = {
  kind: "mixed-fixture-corpus";
  load: typeof loadFixtureSignals;
};

export const fixtureCorpus: MixedFixtureCorpus = {
  kind: "mixed-fixture-corpus",
  load: loadFixtureSignals,
};
