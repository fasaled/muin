import { describe, expect, test } from "bun:test";
import { mcpStdioInvocation } from "./mcp-target.ts";

describe("mcpStdioInvocation", () => {
  test("starts the bundled script with no PDF; the agent calls open", () => {
    const inv = mcpStdioInvocation("/usr/bin/node", "/ext/dist/mcp-stdio.js");
    expect(inv.label).toBe("Muin");
    expect(inv.command).toBe("/usr/bin/node");
    expect(inv.args).toEqual(["/ext/dist/mcp-stdio.js"]);
    expect(inv.args.join(" ")).not.toContain("muin --mcp");
  });

  test("can pass the focused-PDF hint file in the child env", () => {
    const inv = mcpStdioInvocation("/usr/bin/node", "/ext/dist/mcp-stdio.js", {
      MUIN_FOCUSED_PDF_FILE: "/tmp/focused-pdf",
    });
    expect(inv.env).toEqual({ MUIN_FOCUSED_PDF_FILE: "/tmp/focused-pdf" });
  });
});
