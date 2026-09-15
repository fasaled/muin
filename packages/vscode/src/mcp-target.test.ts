import { describe, expect, test } from "bun:test";
import { mcpStdioInvocation, shouldAdvertiseMcp } from "./mcp-target.ts";

describe("shouldAdvertiseMcp", () => {
  test("only with a PDF path", () => {
    expect(shouldAdvertiseMcp(undefined)).toBe(false);
    expect(shouldAdvertiseMcp("")).toBe(false);
    expect(shouldAdvertiseMcp("/tmp/doc.pdf")).toBe(true);
  });
});

describe("mcpStdioInvocation", () => {
  test("points at the bundled script and the PDF, not the CLI binary", () => {
    const inv = mcpStdioInvocation("/usr/bin/node", "/ext/dist/mcp-stdio.js", "/docs/a.pdf");
    expect(inv.label).toBe("Muin");
    expect(inv.command).toBe("/usr/bin/node");
    expect(inv.args).toEqual(["/ext/dist/mcp-stdio.js", "/docs/a.pdf"]);
    expect(inv.args.join(" ")).not.toContain("muin --mcp");
  });
});
