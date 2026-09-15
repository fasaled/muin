import { describe, expect, test } from "bun:test";
import { completionScript, isCompletionShell } from "./completion.ts";
import { parseArgs } from "./cli.ts";

describe("completion", () => {
  test("parseArgs", () => {
    expect(parseArgs(["completion"])).toEqual({ mode: "completion" });
    expect(parseArgs(["completion", "zsh"])).toEqual({ mode: "completion", shell: "zsh" });
  });

  test("isCompletionShell", () => {
    expect(isCompletionShell("bash")).toBe(true);
    expect(isCompletionShell("powershell")).toBe(true);
    expect(isCompletionShell("pwsh")).toBe(true);
  });

  for (const shell of ["bash", "zsh", "fish", "powershell"] as const) {
    test(`${shell} script names commands and flags`, () => {
      const script = completionScript(shell);
      expect(script).toContain("export_graph");
      expect(script.includes("--mcp") || script.includes("-l mcp")).toBe(true);
      expect(script).toContain(".pdf");
    });
  }
});
