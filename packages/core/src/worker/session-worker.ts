import { parentPort } from "node:worker_threads";
import { MuinError } from "../errors.ts";
import { createSessionInProcess, type MuinSession } from "../session-local.ts";
import type { WorkerRequest, WorkerResponse } from "./protocol.ts";

if (!parentPort) {
  throw new Error("session-worker must run as a worker thread");
}

let session: MuinSession | undefined;

function fail(id: number, err: unknown): WorkerResponse {
  if (err instanceof MuinError) {
    return { id, ok: false, error: { name: err.name, message: err.message, code: err.code } };
  }
  if (err instanceof Error) {
    return { id, ok: false, error: { name: err.name, message: err.message, code: "error" } };
  }
  return { id, ok: false, error: { name: "Error", message: String(err), code: "error" } };
}

parentPort.on("message", async (msg: WorkerRequest) => {
  const port = parentPort;
  if (!port) return;
  try {
    switch (msg.type) {
      case "open": {
        session?.close();
        session = await createSessionInProcess(msg.filePath, msg.options);
        port.postMessage({ id: msg.id, ok: true, snapshot: session.snapshot() } satisfies WorkerResponse);
        return;
      }
      case "run": {
        if (!session) throw new Error("no PDF session in worker");
        const result = await session.run(msg.line);
        port.postMessage({
          id: msg.id,
          ok: true,
          result,
          snapshot: session.snapshot(),
        } satisfies WorkerResponse);
        return;
      }
      case "runCommand": {
        if (!session) throw new Error("no PDF session in worker");
        const result = await session.runCommand(msg.cmd);
        port.postMessage({
          id: msg.id,
          ok: true,
          result,
          snapshot: session.snapshot(),
        } satisfies WorkerResponse);
        return;
      }
      case "close": {
        session?.close();
        session = undefined;
        port.postMessage({ id: msg.id, ok: true } satisfies WorkerResponse);
        return;
      }
    }
  } catch (err) {
    port.postMessage(fail(msg.id, err));
  }
});
