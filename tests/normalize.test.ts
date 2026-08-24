import { describe, expect, it } from "vitest";
import { normalizeExpression } from "../src/domain/normalize.js";

describe("normalizeExpression", () => {
  it("normalizes Chinese punctuation and Unicode whitespace without changing the original", () => {
    expect(normalizeExpression(" AI  工作流！ \u00a0\u2003")).toEqual({
      original: " AI  工作流！ \u00a0\u2003",
      normalized: "ai 工作流",
    });
  });

  it("folds Latin case, removes URLs, and leaves meaningful Chinese text", () => {
    expect(normalizeExpression("AI 工作流 https://example.com/Tool A.I.")).toEqual({
      original: "AI 工作流 https://example.com/Tool A.I.",
      normalized: "ai 工作流 a i",
    });
  });
});
