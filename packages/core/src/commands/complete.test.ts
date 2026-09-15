import { describe, expect, test } from "bun:test";
import { complete, COMPLETION_MAX_ITEMS } from "./complete.ts";

const ctx = { neighborRefs: ["3 0 R", "4 0 R"] };

describe("complete", () => {
  test("completes command names on the first token", () => {
    expect(complete("f", 1, ctx)).toEqual({ items: ["find"], replaceFrom: 0 });
    expect(complete("c", 1, ctx).items).toEqual(["cd", "cat", "check"]);
  });

  test("includes client-only extra commands", () => {
    expect(complete("hi", 2, { ...ctx, extraCommands: ["history"] }).items).toEqual(["history"]);
  });

  test("completes flags for the current command", () => {
    expect(complete("find --t", 8, ctx).items).toEqual(["--type"]);
    expect(complete("stream --", 9, ctx).items).toEqual(["--raw", "--decoded"]);
  });

  test("commands without known flags complete nothing for a dash", () => {
    expect(complete("ls --", 5, ctx).items).toEqual([]);
  });

  test("completes ref arguments from neighborRefs for ref-taking commands", () => {
    expect(complete("cd 3", 4, ctx)).toEqual({ items: ["3 0 R"], replaceFrom: 3 });
    expect(complete("refs ", 5, ctx).items).toEqual(["3 0 R", "4 0 R"]);
  });

  test("no completions for a command that doesn't take a ref", () => {
    expect(complete("check ", 6, ctx).items).toEqual([]);
  });

  test("completes at the cursor, ignoring text after it", () => {
    expect(complete("cd 3 0 R extra", 4, ctx).items).toEqual(["3 0 R"]);
  });

  test("caps the item list so a large neighborhood doesn't produce an unusable menu", () => {
    const manyRefs = Array.from({ length: 50 }, (_, i) => `${i} 0 R`);
    const result = complete("cd ", 3, { neighborRefs: manyRefs });
    expect(result.items.length).toBe(COMPLETION_MAX_ITEMS);
    expect(result.items).toEqual(manyRefs.slice(0, COMPLETION_MAX_ITEMS));
  });
});
