import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createSession, vendorPaths } from "@muin/core";
import { handleWebviewMessage } from "../host.ts";

const wasmReady = existsSync(vendorPaths().wasm);

describe.skipIf(!wasmReady)("VS Code panel host (real PDF)", () => {
  test("ready → cd via graph click → pwd in the overlay", async () => {
    const session = await createSession("fixtures/pdf/minimal.pdf");
    try {
      const ready = await handleWebviewMessage(session, { type: "ready" });
      expect(ready.type).toBe("state");
      if (ready.type !== "state") return;
      expect(ready.cwd).toMatch(/1 0 R/);
      const pages = (ready.graph as { nodes: { ref: string }[] }).nodes.find((n) => n.ref !== "1 0 R");
      expect(pages).toBeDefined();

      const afterCd = await handleWebviewMessage(session, { type: "cd", ref: "2 0 R" });
      expect(afterCd.type).toBe("state");
      if (afterCd.type !== "state") return;
      expect(afterCd.cwd).toBe("2 0 R");

      const pwd = await handleWebviewMessage(session, { type: "run", line: "pwd" });
      expect(pwd.type).toBe("overlay");
      if (pwd.type !== "overlay") return;
      expect(pwd.body).toContain("2 0 R");
    } finally {
      session.close();
    }
  });
});
