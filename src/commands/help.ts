const COMMANDS: Record<string, string> = {
  ls: "ls [<ref>] — list keys, indices, or stream metadata",
  cd: "cd <ref|key|index> — move to an object",
  pwd: "pwd — current object and path from /Root",
  back: "back — previous object in history",
  refs: "refs [<ref>] — outgoing and incoming references",
  cat: "cat [<ref>] — full object (stream header only)",
  stream: "stream <ref> [--raw|--decoded] — extract stream bytes",
  find: 'find --type <Type> [--where "/Key == value"] — search objects',
  tree: "tree [<ref>] [--depth n] — page tree",
  check: "check — structural findings",
  export_graph: "export_graph [--from <ref>] [--depth n] [--find expr] — MCP subgraph JSON",
  help: "help [<command>] — this help",
  quit: "quit / exit — leave the TUI",
};

export function helpText(command?: string): string {
  if (!command) {
    return Object.values(COMMANDS).join("\n");
  }
  const text = COMMANDS[command] ?? COMMANDS[command === "exit" ? "quit" : command];
  if (!text) return `no help for ${command}`;
  return text;
}
