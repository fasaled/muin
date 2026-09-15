import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { formatBytes, formatProcessError, formatSnapshot, type MuinSession } from "@muin/core";

export async function startRepl(session: MuinSession): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout, historySize: 200 });
  const snap0 = session.snapshot();
  stdout.write(`opened ${baseName(session.filePath)}  ${formatSnapshot(snap0.cwd, snap0.path)}\n`);
  stdout.write("help · quit  —  Ctrl+C to exit\n");

  const prompt = () => {
    const s = session.snapshot().cwd;
    return `${s.objectNumber} ${s.generation} R> `;
  };
  stdout.write(prompt());
  try {
    for await (const line of rl) {
      if (line.trim().length === 0) {
        stdout.write(prompt());
        continue;
      }
      try {
        const result = await session.run(line);
        if (result.kind === "quit") break;
        if (result.kind === "text") stdout.write(`${result.text}\n`);
        else if (result.kind === "json") stdout.write(`${JSON.stringify(result.value, null, 2)}\n`);
        else if (result.kind === "bytes") stdout.write(`${formatBytes(result.bytes)}\n`);
      } catch (err) {
        stdout.write(`error: ${formatProcessError(err)}\n`);
      }
      stdout.write(prompt());
    }
  } finally {
    rl.close();
  }
}

function baseName(path: string): string {
  return path.replace(/^.*[/\\]/, "") || path;
}
