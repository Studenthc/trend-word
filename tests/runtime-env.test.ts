import { describe, expect, it } from "vitest";
import { inheritLaunchdEnvironment } from "../src/runtime-env.js";

describe("launchd environment inheritance", () => {
  it("imports only allowlisted missing variables", () => {
    const target: NodeJS.ProcessEnv = { RADAR_ENABLE_PUBLIC_HTTP: "0" };
    inheritLaunchdEnvironment(target, (name) => ({ PRODUCT_HUNT_API_TOKEN: "secret", RADAR_ENABLE_PUBLIC_HTTP: "1", RADAR_GITHUB_TOKEN: "gh" }[name]));
    expect(target).toMatchObject({ PRODUCT_HUNT_API_TOKEN: "secret", RADAR_ENABLE_PUBLIC_HTTP: "0" });
    expect(target).toHaveProperty("RADAR_GITHUB_TOKEN", "gh");
  });

  it("ignores unavailable launchd values", () => {
    const target: NodeJS.ProcessEnv = {};
    inheritLaunchdEnvironment(target, () => undefined);
    expect(target).toEqual({});
  });
});
