import { fork, type ChildProcess } from "node:child_process";
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

type Bridge = {
  send: (msg: WorkerRequest) => void;
  onMessage: (fn: (msg: WorkerResponse) => void) => void;
  onError: (fn: (err: Error) => void) => void;
  onExit: (fn: (code: number | null) => void) => void;
  terminate: () => Promise<void>;
};

function forkEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
  return env;
}

function startFork(script: string): Bridge {
  const child: ChildProcess = fork(script, [], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    env: forkEnv(),
    execArgv: [],
    serialization: "advanced",
  });
  return {
    send: (msg) => {
      child.send(msg);
    },
    onMessage: (fn) => {
      child.on("message", fn);
    },
    onError: (fn) => {
      child.on("error", fn);
    },
    onExit: (fn) => {
      child.on("exit", (code) => {
        fn(code);
      });
    },
    terminate: async () => {
      if (child.killed || child.exitCode !== null) return;
      child.kill();
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        setTimeout(resolve, 1000);
      });
    },
  };
}

function startWorker(script: string): Bridge {
  const worker = new Worker(script);
  return {
    send: (msg) => {
      worker.postMessage(msg);
    },
    onMessage: (fn) => {
      worker.on("message", fn);
    },
    onError: (fn) => {
      worker.on("error", fn);
    },
    onExit: (fn) => {
      worker.on("exit", (code) => {
        fn(code);
      });
    },
    terminate: async () => {
      await worker.terminate();
    },
  };
}

function useChildProcess(workerProcess: boolean | undefined): boolean {
  if (workerProcess === true) return true;
  if (workerProcess === false) return false;
  return Boolean(process.versions.electron);
}

export async function createWorkerSession(
  filePath: string,
  options: SessionOptions = {},
): Promise<MuinSession> {
  const { workerScript, workerProcess, ...openOptions } = options;
  const script = workerScript ?? resolveSessionWorker();
  const bridge = useChildProcess(workerProcess) ? startFork(script) : startWorker(script);
  let nextId = 1;
  const pending = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void }>();
  let snap: SessionSnapshot = { cwd: { objectNumber: 0, generation: 0 }, path: [], historyLength: 0 };
  let closed = false;
  let chain: Promise<void> = Promise.resolve();

  bridge.onMessage((msg: WorkerResponse) => {
    pending.get(msg.id)?.resolve(msg);
    pending.delete(msg.id);
  });
  bridge.onError((err) => {
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  });
  bridge.onExit((code) => {
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
        bridge.send({ ...req, id } satisfies WorkerRequest);
      });
    const job = chain.then(run, run);
    chain = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  };

  try {
    const opened = await rpc({ type: "open", filePath, options: openOptions });
    if (!opened.ok) throw reviveError(opened.error);
    if (opened.snapshot) snap = opened.snapshot;
  } catch (err) {
    closed = true;
    await bridge.terminate();
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
          void bridge.terminate();
        });
    },
  };
}
