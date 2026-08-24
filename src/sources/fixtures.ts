import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseRawSignal, type RawSignal, type SourceCollection, type SourceContext } from "../types.js";

const fixturePath = fileURLToPath(new URL("../../fixtures/sample-signals.jsonl", import.meta.url));

export async function loadFixtureSignals(): Promise<RawSignal[]> {
  const lines = (await readFile(fixturePath, "utf8")).split(/\r?\n/u).filter((line) => line.trim());
  return lines.map((line) => parseRawSignal(JSON.parse(line) as unknown));
}

export async function collectFixtures(context: SourceContext): Promise<SourceCollection> {
  const signals = await loadFixtureSignals();
  return {
    signals,
    health: {
      sourceType: "fixtures",
      status: "partial",
      attemptedAt: context.fetchedAt,
      endpointCount: 6,
      successfulEndpointCount: 5,
      itemCount: signals.length,
      failureReasons: ["reddit-feed fixture includes a failed HTTP 429 record"],
      coverageNotes: ["Fixture-only mixed-source corpus; failed records remain raw audit data."],
    },
  };
}

export type MixedFixtureCorpus = {
  kind: "mixed-fixture-corpus";
  collect: typeof collectFixtures;
};

export const fixtureCorpus: MixedFixtureCorpus = {
  kind: "mixed-fixture-corpus",
  collect: collectFixtures,
};
