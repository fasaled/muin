import { render } from "ink";
import { createElement } from "react";
import type { PdfAdapter } from "../pdf/adapter.ts";
import type { Session } from "../graph/session.ts";
import { App } from "./App.tsx";

export async function startTui(session: Session, adapter: PdfAdapter): Promise<void> {
  const instance = render(createElement(App, { session, adapter }));
  await instance.waitUntilExit();
}
