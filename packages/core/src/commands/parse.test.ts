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

  test("stream defaults to the current object when no ref is given", () => {
    expect(parseCommand("stream")).toEqual({ name: "stream", mode: "decoded" });
    expect(parseCommand("stream --raw")).toEqual({ name: "stream", mode: "raw" });
    expect(parseCommand("stream 5 0 R --raw")).toEqual({ name: "stream", ref: "5 0 R", mode: "raw" });
  });

  test("stream rejects more than one ref", () => {
    expect(() => parseCommand("stream 5 0 R 6 0 R")).toThrow(UsageError);
  });

  test("find requires --type", () => {
    expect(() => parseCommand("find --where /Type==/Page")).toThrow(UsageError);
  });

  test("neighbors accepts an optional ref", () => {
    expect(parseCommand("neighbors")).toEqual({ name: "neighbors" });
    expect(parseCommand("neighbors 4 0 R")).toEqual({ name: "neighbors", ref: "4 0 R" });
  });

  test("export_graph flags", () => {
    expect(parseCommand("export_graph --from 1 0 R --depth 3")).toEqual({
      name: "export_graph",
      from: "1 0 R",
      depth: 3,
    });
  });
});
