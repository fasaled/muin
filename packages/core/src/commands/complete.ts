import { COMMAND_NAMES } from "./help.ts";

export type CompletionContext = {
  /** "O G R" strings already known to the client (e.g. from `neighbors`). */
  neighborRefs: string[];
  /** Client-only command names not in the core grammar (e.g. the TUI's `history`). */
  extraCommands?: string[];
  /** Override the display cap for an initial command list; contextual completion stays capped by default. */
  maxItems?: number;
};

const FLAGS: Record<string, string[]> = {
  find: ["--type", "--where"],
  stream: ["--raw", "--decoded"],
  tree: ["--depth"],
  export_graph: ["--from", "--depth", "--find"],
};

const REF_ARG_COMMANDS = new Set(["cd", "ls", "cat", "refs", "neighbors", "tree", "stream"]);

/** Cap on returned items — a neighborhood can have up to `NEIGHBORS_DEFAULT_LIMIT` refs; a
 * completion menu that long isn't usable in either client, so both get the same short list. */
export const COMPLETION_MAX_ITEMS = 8;

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

  const command = tokens[0] ?? "";
  if (REF_ARG_COMMANDS.has(command) && !partial.startsWith("-")) {
    const commandEnd = before.indexOf(command) + command.length;
    const argumentText = before.slice(commandEnd).trimStart();
    const argumentStart = before.length - argumentText.length;
    const refItems = ctx.neighborRefs.filter((ref) => ref.startsWith(argumentText));
    return {
      items: refItems.slice(0, ctx.maxItems ?? COMPLETION_MAX_ITEMS),
      replaceFrom: argumentStart,
    };
  }

  const items = (() => {
    if (tokens.length === 0) {
      const names: readonly string[] = [...COMMAND_NAMES, ...(ctx.extraCommands ?? [])];
      return names.filter((c) => c.startsWith(partial));
    }
    const cmd = command;
    if (partial.startsWith("-")) {
      return (FLAGS[cmd] ?? []).filter((f) => f.startsWith(partial));
    }
    if (REF_ARG_COMMANDS.has(cmd)) {
      return ctx.neighborRefs.filter((r) => r.startsWith(partial));
    }
    return [];
  })();

  return { items: items.slice(0, ctx.maxItems ?? COMPLETION_MAX_ITEMS), replaceFrom };
}
