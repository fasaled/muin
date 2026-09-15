import { describe, expect, test } from "bun:test";
import { LimitError } from "./errors.ts";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_JSON_BYTES,
  EXPORT_MAX_DEPTH,
  EXPORT_MAX_NODES,
  assertExportNodeCount,
  assertFileSize,
  assertJsonSize,
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

  test("export node count", () => {
    assertExportNodeCount(EXPORT_MAX_NODES);
    expect(() => assertExportNodeCount(EXPORT_MAX_NODES + 1)).toThrow(LimitError);
  });

  test("json size", () => {
    assertJsonSize(100);
    expect(() => assertJsonSize(DEFAULT_MAX_JSON_BYTES + 1)).toThrow(LimitError);
  });
});
