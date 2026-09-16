import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { vendorPaths } from "@muin/core";

async function runCli(args: string[], opts: { timeoutMs?: number } = {}) {
  const proc = Bun.spawn(["bun", "packages/cli/src/cli.ts", ...args], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const killer = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(killer);
  return { stdout, stderr, exitCode };
}

describe("CLI process", () => {
  test("--help exits 0", async () => {
    const { stdout, exitCode } = await runCli(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("muin --mcp");
  });

  test("--version prints the package version", async () => {
    const pkg = await Bun.file(new URL("../../package.json", import.meta.url)).json();
    const { stdout, exitCode } = await runCli(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(pkg.version);
  });

  test("missing file is a usage error", async () => {
    const { stderr, exitCode } = await runCli([]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("missing PDF path");
  });

  test("unknown flag is a usage error", async () => {
    const { stderr, exitCode } = await runCli(["--nope", "a.pdf"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("unknown option");
  });

  test("--max-bytes rejects a too-large file", async () => {
    if (!existsSync(vendorPaths().wasm)) return;
    const { stderr, exitCode } = await runCli(["--max-bytes", "1", "fixtures/pdf/minimal.pdf"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("exceeds the limit");
  });

  test("corrupt PDF does not crash", async () => {
    if (!existsSync(vendorPaths().wasm)) return;
    const { stderr, exitCode } = await runCli(["fixtures/pdf/corrupt.pdf"]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/muin:/);
  });

  test("missing file is a clear error", async () => {
    const { stderr, exitCode } = await runCli(["/no/such/muin-file.pdf"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("file not found");
  });

  test("one-shot check and ls", async () => {
    if (!existsSync(vendorPaths().wasm)) return;
    const check = await runCli(["fixtures/pdf/minimal.pdf", "check"]);
    expect(check.exitCode).toBe(0);
    expect(check.stdout.length).toBeGreaterThan(0);

    const ls = await runCli(["fixtures/pdf/minimal.pdf", "ls"]);
    expect(ls.exitCode).toBe(0);
    expect(ls.stdout).toContain("/Pages");
  });

  test("muin help lists commands without opening a PDF", async () => {
    const { stdout, exitCode } = await runCli(["help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("ls");
    expect(stdout).toContain("find");
  });

  test("completion prints a zsh script", async () => {
    const { stdout, exitCode } = await runCli(["completion", "zsh"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("#compdef muin");
    expect(stdout).toContain("export_graph");
  });
});


