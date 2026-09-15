import { describe, expect, test } from "bun:test";
import { LimitError } from "./errors.ts";
import {
  DEFAULT_MAX_BYTES,
  EXPORT_MAX_DEPTH,
  assertFileSize,
  assertObjectCount,
  clampExportDepth,
} from "./limits.ts";

describe("limits", () => {
  test("file size", () => {
    assertFileSize(100);
    expect(() => assertFileSize(DEFAULT_MAX_BYTES + 1)).toThrow(LimitError);
  });

  test("object count", () => {
    assertObjectCount(10);
    expect(() => assertObjectCount(200_001)).toThrow(LimitError);
  });

  test("export depth", () => {
    expect(clampExportDepth(0)).toBe(0);
    expect(clampExportDepth(EXPORT_MAX_DEPTH)).toBe(EXPORT_MAX_DEPTH);
    expect(() => clampExportDepth(EXPORT_MAX_DEPTH + 1)).toThrow(LimitError);
    expect(() => clampExportDepth(-1)).toThrow(LimitError);
  });
});
