import { describe, expect, test } from "bun:test";
import { UsageError } from "../errors.ts";
import { parseCommand, tokenize } from "./parse.ts";

describe("tokenize", () => {
  test("splits on whitespace and keeps quotes", () => {
    expect(tokenize('find --where "/Filter == /FlateDecode"')).toEqual([
      "find",
      "--where",
      "/Filter == /FlateDecode",
    ]);
  });

  test("rejects unterminated quotes", () => {
    expect(() => tokenize('ls "oops')).toThrow(UsageError);
  });
});

describe("parseCommand", () => {
  test("quit aliases", () => {
    expect(parseCommand("quit")).toEqual({ name: "quit" });
    expect(parseCommand("exit")).toEqual({ name: "quit" });
  });

  test("help with a command", () => {
    expect(parseCommand("help cd")).toEqual({ name: "help", command: "cd" });
  });

  test("empty and unknown", () => {
    expect(() => parseCommand("")).toThrow(UsageError);
    expect(() => parseCommand("nope")).toThrow(UsageError);
  });

  test("cd requires a target", () => {
    expect(() => parseCommand("cd")).toThrow(UsageError);
  });

  test("stream rejects both flags", () => {
    expect(() => parseCommand("stream 5 0 R --raw --decoded")).toThrow(UsageError);
  });

  test("find requires --type", () => {
    expect(() => parseCommand("find --where /Type==/Page")).toThrow(UsageError);
  });

  test("export_graph flags", () => {
    expect(parseCommand("export_graph --from 1 0 R --depth 3")).toEqual({
      name: "export_graph",
      from: "1 0 R",
      depth: 3,
    });
  });
});
