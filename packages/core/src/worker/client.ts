import { Worker } from "node:worker_threads";
import {
  CorruptPdfError,
  EncryptedPdfError,
  LimitError,
  MuinError,
  NotFoundError,
  UsageError,
} from "../errors.ts";
import type { ParsedCommand } from "../commands/parse.ts";
import type { CommandResult, MuinSession, SessionOptions, SessionSnapshot } from "../session-local.ts";
import type { WorkerRequest, WorkerRequestBody, WorkerResponse } from "./protocol.ts";
import { resolveSessionWorker } from "./path.ts";

function reviveError(shape: { name: string; message: string; code: string }): Error {
  switch (shape.name) {
    case "UsageError":
      return new UsageError(shape.message);
    case "NotFoundError":
      return new NotFoundError(shape.message);
    case "EncryptedPdfError":
      return new EncryptedPdfError(shape.message);
    case "CorruptPdfError":
      return new CorruptPdfError(shape.message);
    case "LimitError":
      return new LimitError(shape.message);
    default:
      return new MuinError(shape.code, shape.message);
  }
}

export async function createWorkerSession(
  filePath: string,
  options: SessionOptions = {},
): Promise<MuinSession> {
  const script = resolveSessionWorker();
  const worker = new Worker(script);
  let nextId = 1;
  const pending = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void }>();
  let snap: SessionSnapshot = { cwd: { objectNumber: 0, generation: 0 }, path: [], historyLength: 0 };
  let closed = false;
  let chain: Promise<void> = Promise.resolve();

  worker.on("message", (msg: WorkerResponse) => {
    pending.get(msg.id)?.resolve(msg);
    pending.delete(msg.id);
  });
  worker.on("error", (err) => {
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  });
  worker.on("exit", (code) => {
    if (closed) return;
    const err = new Error(`muin session worker exited (${code})`);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  });

  const rpc = (req: WorkerRequestBody): Promise<WorkerResponse> => {
    const run = () =>
      new Promise<WorkerResponse>((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        worker.postMessage({ ...req, id } satisfies WorkerRequest);
      });
    const job = chain.then(run, run);
    chain = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  };

  try {
    const opened = await rpc({ type: "open", filePath, options });
    if (!opened.ok) throw reviveError(opened.error);
    if (opened.snapshot) snap = opened.snapshot;
  } catch (err) {
    closed = true;
    await worker.terminate();
    throw err;
  }

  return {
    filePath,
    snapshot: () => snap,
    run: async (line: string) => {
      const res = await rpc({ type: "run", line });
      if (!res.ok) throw reviveError(res.error);
      if (res.snapshot) snap = res.snapshot;
      return res.result as CommandResult;
    },
    runCommand: async (cmd: ParsedCommand) => {
      const res = await rpc({ type: "runCommand", cmd });
      if (!res.ok) throw reviveError(res.error);
      if (res.snapshot) snap = res.snapshot;
      return res.result as CommandResult;
    },
    close: () => {
      if (closed) return;
      closed = true;
      void rpc({ type: "close" })
        .catch(() => undefined)
        .finally(() => {
          void worker.terminate();
        });
    },
  };
}
