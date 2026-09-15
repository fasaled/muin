const COMMANDS: Record<string, string> = {
  ls: "list keys, indices, or stream metadata",
  cd: "move to an object (O G R, /Key, or array index)",
  pwd: "current object and path from /Root",
  back: "previous object in history",
  refs: "outgoing and incoming references",
  cat: "full object (stream header only, not bytes)",
  stream: "extract stream bytes (--raw or --decoded, default decoded)",
  find: 'search objects (--type required; optional --where "/Key == value")',
  tree: "page tree from /Pages (optional --depth)",
  check: "structural findings (irregular files do not crash)",
  export_graph: "bounded subgraph JSON (--from/--depth or --find)",
  help: "this list, or help <command>",
  quit: "leave the session (also: exit, Ctrl+C, Ctrl+D)",
};

const ORDER = [
  "ls",
  "cd",
  "pwd",
  "back",
  "refs",
  "cat",
  "stream",
  "find",
  "tree",
  "check",
  "export_graph",
  "help",
  "quit",
] as const;

export function helpText(command?: string): string {
  if (!command) {
    const width = Math.max(...ORDER.map((name) => name.length));
    return ORDER.map((name) => {
      const blurb = COMMANDS[name] ?? "";
      return `${name.padEnd(width)}  ${blurb}`;
    }).join("\n");
  }
  const key = command === "exit" ? "quit" : command;
  const blurb = COMMANDS[key];
  if (!blurb) return `no help for ${command}. Try help`;
  return `${key}  ${blurb}`;
}
