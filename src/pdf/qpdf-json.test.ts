import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { EncryptedPdfError } from "../errors.ts";
import { dictGet, isStream, nameEquals } from "./model.ts";
import { parseQpdfJson } from "./qpdf-json.ts";

const minimal = JSON.parse(
  readFileSync(new URL("../../fixtures/json/minimal.json", import.meta.url), "utf8"),
) as unknown;

describe("parseQpdfJson", () => {
  test("parses the minimal fixture", () => {
    const doc = parseQpdfJson(minimal);
    expect(doc.pdfVersion).toBe("1.3");
    expect(doc.objects["1 0 R"]?.value.kind).toBe("dict");
    const catalog = doc.objects["1 0 R"]?.value;
    expect(catalog && nameEquals(catalog.kind === "dict" ? dictGet(catalog, "/Type") : undefined, "Catalog")).toBe(
      true,
    );
    const stream = doc.objects["5 0 R"]?.value;
    expect(stream && isStream(stream)).toBe(true);
    if (stream && isStream(stream)) {
      expect(stream.length).toBe(10);
      expect(nameEquals(dictGet(stream.dict, "/Filter"), "FlateDecode")).toBe(true);
    }
    const root = dictGet(doc.trailer, "/Root");
    expect(root?.kind).toBe("ref");
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
});
