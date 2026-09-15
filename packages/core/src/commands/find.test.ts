import { describe, expect, test } from "bun:test";
import { matchType, matchWhere, parseWhere } from "./find.ts";

describe("parseWhere", () => {
  test("equality on a name", () => {
    expect(parseWhere("/Filter == /FlateDecode")).toEqual([
      { key: "/Filter", op: "==", value: { kind: "name", value: "/FlateDecode" } },
    ]);
  });

  test("AND of number and name", () => {
    const clauses = parseWhere("/Length > 10 AND /Filter == /FlateDecode");
    expect(clauses).toHaveLength(2);
  });
});

describe("matchWhere", () => {
  const stream = {
    kind: "stream" as const,
    length: 20,
    dict: {
      kind: "dict" as const,
      entries: {
        "/Length": { kind: "number" as const, value: 20 },
        "/Filter": { kind: "name" as const, value: "/FlateDecode" },
      },
    },
  };

  test("matches stream dict", () => {
    expect(matchWhere(stream, parseWhere("/Filter == /FlateDecode"))).toBe(true);
    expect(matchWhere(stream, parseWhere("/Length > 10"))).toBe(true);
    expect(matchWhere(stream, parseWhere("/Filter == /DCTDecode"))).toBe(false);
  });
});

describe("matchType", () => {
  test("stream kind", () => {
    expect(
      matchType(
        { kind: "stream", length: 1, dict: { kind: "dict", entries: {} } },
        "Stream",
      ),
    ).toBe(true);
  });
});
