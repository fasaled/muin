import { render } from "ink";
import { createElement } from "react";
import type { MuinSession } from "@muin/core";
import { App } from "./App.tsx";
import { startRepl } from "./repl.ts";

export async function startTui(session: MuinSession): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    await startRepl(session);
    return;
  }
  const instance = render(createElement(App, { session }), { alternateScreen: true });
  await instance.waitUntilExit();
}
