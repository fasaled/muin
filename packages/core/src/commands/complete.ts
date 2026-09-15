import { COMMAND_NAMES } from "./help.ts";

export type CompletionContext = {
  /** "O G R" strings already known to the client (e.g. from `neighbors`). */
  neighborRefs: string[];
  /** Client-only command names not in the core grammar (e.g. the TUI's `history`). */
  extraCommands?: string[];
};

const FLAGS: Record<string, string[]> = {
  find: ["--type", "--where"],
  stream: ["--raw", "--decoded"],
  tree: ["--depth"],
  export_graph: ["--from", "--depth", "--find"],
};

const REF_ARG_COMMANDS = new Set(["cd", "ls", "cat", "refs", "neighbors", "tree", "stream"]);

export type CompletionResult = {
  items: string[];
  /** Index in `line` where the completed word starts; splice a chosen item in from here to `cursor`. */
  replaceFrom: number;
};

/** Complete the word at `cursor` in `line`. Pure and static: no PDF access. */
export function complete(line: string, cursor: number, ctx: CompletionContext): CompletionResult {
  const before = line.slice(0, cursor);
  const match = /(\S*)$/.exec(before);
  const partial = match?.[1] ?? "";
  const replaceFrom = cursor - partial.length;
  const head = before.slice(0, replaceFrom);
  const tokens = head.trim().split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    const names: readonly string[] = [...COMMAND_NAMES, ...(ctx.extraCommands ?? [])];
    return { items: names.filter((c) => c.startsWith(partial)), replaceFrom };
  }

  const cmd = tokens[0] ?? "";
  if (partial.startsWith("-")) {
    return { items: (FLAGS[cmd] ?? []).filter((f) => f.startsWith(partial)), replaceFrom };
  }
  if (REF_ARG_COMMANDS.has(cmd)) {
    return { items: ctx.neighborRefs.filter((r) => r.startsWith(partial)), replaceFrom };
  }
  return { items: [], replaceFrom };
}
