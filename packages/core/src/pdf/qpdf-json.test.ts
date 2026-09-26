import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CorruptPdfError, EncryptedPdfError, LimitError } from "../errors.ts";
import { fixturePath } from "../test/helpers.ts";
import { dictGet, isStream, nameEquals } from "./model.ts";
import { parseQpdfJson } from "./qpdf-json.ts";

const minimal = JSON.parse(readFileSync(fixturePath("json", "minimal.json"), "utf8")) as unknown;

describe("parseQpdfJson", () => {
  test("parses the minimal fixture", () => {
    const doc = parseQpdfJson(minimal);
    expect(doc.pdfVersion).toBe("1.1");
    expect(Object.keys(doc.objects).sort()).toEqual(["1 0 R", "2 0 R", "3 0 R"]);
    expect(doc.objects["1 0 R"]?.value.kind).toBe("dict");
    const catalog = doc.objects["1 0 R"]?.value;
    expect(catalog && nameEquals(catalog.kind === "dict" ? dictGet(catalog, "/Type") : undefined, "Catalog")).toBe(
      true,
    );
    const pages = doc.objects["2 0 R"]?.value;
    expect(pages && nameEquals(pages.kind === "dict" ? dictGet(pages, "/Type") : undefined, "Pages")).toBe(true);
    const root = dictGet(doc.trailer, "/Root");
    expect(root?.kind).toBe("ref");
  });

  test("parses stream objects", () => {
    const doc = parseQpdfJson({
      qpdf: [
        { jsonversion: 2 },
        {
          "obj:4 0 R": { stream: { dict: { "/Length": 10, "/Filter": "/FlateDecode" }, data: null } },
          trailer: { value: { "/Root": "1 0 R" } },
        },
      ],
    });
    const stream = doc.objects["4 0 R"]?.value;
    expect(stream && isStream(stream)).toBe(true);
    if (stream && isStream(stream)) {
      expect(stream.length).toBe(10);
      expect(nameEquals(dictGet(stream.dict, "/Filter"), "FlateDecode")).toBe(true);
    }
  });

  test("rejects encrypted trailers", () => {
    const encrypted = structuredClone(minimal) as {
      qpdf: [unknown, Record<string, unknown>];
    };
    const objects = encrypted.qpdf[1];
    const trailer = objects["trailer"] as { value: Record<string, unknown> };
    trailer.value["/Encrypt"] = "9 0 R";
    expect(() => parseQpdfJson(encrypted)).toThrow(EncryptedPdfError);
  });

  test("rejects malformed input", () => {
    expect(() => parseQpdfJson(null)).toThrow(CorruptPdfError);
    expect(() => parseQpdfJson({})).toThrow(CorruptPdfError);
    expect(() => parseQpdfJson({ qpdf: [] })).toThrow(CorruptPdfError);
  });

  test("rejects a missing trailer", () => {
    const clone = structuredClone(minimal) as { qpdf: [unknown, Record<string, unknown>] };
    delete clone.qpdf[1]["trailer"];
    expect(() => parseQpdfJson(clone)).toThrow(CorruptPdfError);
  });

  test("enforces object-count limit", () => {
    expect(() => parseQpdfJson(minimal, 2)).toThrow(LimitError);
  });
});
