import { describe, expect, test } from "bun:test";
import { NotFoundError } from "../errors.ts";
import { loadMinimalStructure, minimalSession } from "../test/helpers.ts";
import { back, cd, getValue, incoming, openSession, outgoingRefs } from "./session.ts";

describe("session", () => {
  test("opens at /Root", () => {
    const s = minimalSession();
    expect(s.cwd).toEqual({ objectNumber: 1, generation: 0 });
    expect(s.path).toEqual(["/Root"]);
    expect(s.history).toEqual([]);
  });

  test("rejects a trailer without /Root", () => {
    const structure = loadMinimalStructure();
    delete structure.trailer.entries["/Root"];
    expect(() => openSession("x.pdf", structure)).toThrow(NotFoundError);
  });

  test("cd by key and back", () => {
    const s = cd(minimalSession(), "/Pages");
    expect(s.cwd).toEqual({ objectNumber: 3, generation: 0 });
    expect(s.path).toEqual(["/Root", "/Pages"]);
    const prev = back(s);
    expect(prev.cwd).toEqual({ objectNumber: 1, generation: 0 });
    expect(prev.path).toEqual(["/Root"]);
    expect(prev.history).toEqual([]);
  });

  test("cd by ref replaces the path", () => {
    const s = cd(minimalSession(), "4 0 R");
    expect(s.cwd).toEqual({ objectNumber: 4, generation: 0 });
    expect(s.path).toEqual(["4 0 R"]);
  });

  test("back after cd by ref restores the prior path, not just cwd", () => {
    const start = cd(minimalSession(), "/Pages");
    const jumped = cd(start, "4 0 R");
    expect(jumped.path).toEqual(["4 0 R"]);
    const prev = back(jumped);
    expect(prev.cwd).toEqual({ objectNumber: 3, generation: 0 });
    expect(prev.path).toEqual(["/Root", "/Pages"]);
  });

  test("cd by array index when the current object is an array", () => {
    const structure = loadMinimalStructure();
    structure.objects["6 0 R"] = {
      ref: { objectNumber: 6, generation: 0 },
      value: {
        kind: "array",
        items: [{ kind: "ref", ref: { objectNumber: 4, generation: 0 } }],
      },
    };
    const catalog = structure.objects["1 0 R"];
    if (catalog && catalog.value.kind === "dict") {
      catalog.value.entries["/Arr"] = { kind: "ref", ref: { objectNumber: 6, generation: 0 } };
    }
    const s = openSession("minimal.pdf", structure);
    const arr = cd(s, "/Arr");
    const page = cd(arr, "0");
    expect(page.cwd).toEqual({ objectNumber: 4, generation: 0 });
    expect(page.path.at(-1)).toBe("[0]");
  });

  test("missing key and empty history", () => {
    expect(() => cd(minimalSession(), "/NoSuchKey")).toThrow(NotFoundError);
    expect(() => back(minimalSession())).toThrow(NotFoundError);
    expect(() => getValue(minimalSession(), { objectNumber: 99, generation: 0 })).toThrow(NotFoundError);
  });

  test("outgoing and incoming refs", () => {
    const s = cd(minimalSession(), "/Pages");
    expect(outgoingRefs(s).map((r) => r.objectNumber)).toContain(4);
    expect(incoming(s).some((r) => r.objectNumber === 1)).toBe(true);
  });
});
