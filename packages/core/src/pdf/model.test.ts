import { describe, expect, test } from "bun:test";
import { collectRefs, parseRef, refKey, type PdfDict } from "./model.ts";

describe("parseRef", () => {
  test("accepts PDF syntax and shortcuts", () => {
    expect(parseRef("3 0 R")).toEqual({ objectNumber: 3, generation: 0 });
    expect(parseRef("  12,1 ")).toEqual({ objectNumber: 12, generation: 1 });
    expect(parseRef("4 0")).toEqual({ objectNumber: 4, generation: 0 });
  });

  test("rejects junk", () => {
    expect(parseRef("/Root")).toBeUndefined();
    expect(parseRef("")).toBeUndefined();
  });
});

describe("collectRefs", () => {
  test("walks dicts and arrays", () => {
    const dict: PdfDict = {
      kind: "dict",
      entries: {
        "/Pages": { kind: "ref", ref: { objectNumber: 3, generation: 0 } },
        "/Kids": {
          kind: "array",
          items: [
            { kind: "ref", ref: { objectNumber: 4, generation: 0 } },
            { kind: "number", value: 1 },
          ],
        },
      },
    };
    const refs = collectRefs(dict);
    expect(refs.map(refKey).sort()).toEqual(["3 0 R", "4 0 R"]);
  });
});
