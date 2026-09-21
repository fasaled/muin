import { describe, expect, test } from "bun:test";
import { VERSION } from "./version.ts";

describe("VERSION", () => {
  test("matches every workspace package", async () => {
    const names = ["core", "cli"] as const;
    for (const name of names) {
      const pkg = await Bun.file(new URL(`../../${name}/package.json`, import.meta.url)).json();
      expect(pkg.version).toBe(VERSION);
    }
  });
});
