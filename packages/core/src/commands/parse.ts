import { UsageError } from "../errors.ts";

export type ParsedCommand =
  | { name: "ls"; ref?: string }
  | { name: "cd"; target: string }
  | { name: "pwd" }
  | { name: "back" }
  | { name: "refs"; ref?: string }
  | { name: "cat"; ref?: string }
  | { name: "stream"; ref: string; mode: "raw" | "decoded" }
  | { name: "find"; type: string; where?: string }
  | { name: "tree"; ref?: string; depth?: number }
  | { name: "check" }
  | { name: "export_graph"; from?: string; depth?: number; find?: string }
  | { name: "help"; command?: string }
  | { name: "quit" };

export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === undefined) continue;
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur.length > 0) {
        tokens.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (quote) throw new UsageError("unterminated quote");
  if (cur.length > 0) tokens.push(cur);
  return tokens;
}

function takeRefTokens(tokens: string[], start: number): { value: string; count: number } | undefined {
  const a = tokens[start];
  const b = tokens[start + 1];
  const c = tokens[start + 2];
  if (a && b && c === "R" && /^\d+$/.test(a) && /^\d+$/.test(b)) {
    return { value: `${a} ${b} R`, count: 3 };
  }
  return undefined;
}

function optFlag(tokens: string[], name: string): string | undefined {
  const i = tokens.indexOf(name);
  if (i === -1) return undefined;
  const v = tokens[i + 1];
  if (v === undefined || v.startsWith("-")) {
    throw new UsageError(`${name} requires a value`);
  }
  const asRef = takeRefTokens(tokens, i + 1);
  if (asRef) {
    tokens.splice(i, 1 + asRef.count);
    return asRef.value;
  }
  tokens.splice(i, 2);
  return v;
}

function flagSet(tokens: string[], name: string): boolean {
  const i = tokens.indexOf(name);
  if (i === -1) return false;
  tokens.splice(i, 1);
  return true;
}

function positionals(tokens: string[]): string[] {
  const extra = tokens.filter((t) => !t.startsWith("-"));
  const out: string[] = [];
  for (let i = 0; i < extra.length; i++) {
    const a = extra[i];
    const b = extra[i + 1];
    const c = extra[i + 2];
    if (a && b && c === "R" && /^\d+$/.test(a) && /^\d+$/.test(b)) {
      out.push(`${a} ${b} R`);
      i += 2;
    } else if (a) {
      out.push(a);
    }
  }
  return out;
}

export function parseCommand(line: string): ParsedCommand {
  const tokens = tokenize(line.trim());
  const cmd = tokens.shift();
  if (!cmd) throw new UsageError("empty command");
  switch (cmd) {
    case "ls":
    case "refs":
    case "cat": {
      const extra = positionals(tokens);
      if (extra.length > 1) throw new UsageError(`${cmd} takes at most one ref`);
      const ref = extra[0];
      return ref === undefined ? { name: cmd } : { name: cmd, ref };
    }
    case "cd": {
      const extra = positionals(tokens);
      if (extra.length !== 1) throw new UsageError("cd requires a target");
      return { name: "cd", target: extra[0]! };
    }
    case "pwd":
    case "back":
    case "check":
      return { name: cmd };
    case "quit":
    case "exit":
      return { name: "quit" };
    case "help": {
      const extra = positionals(tokens);
      return extra[0] === undefined ? { name: "help" } : { name: "help", command: extra[0] };
    }
    case "stream": {
      const raw = flagSet(tokens, "--raw");
      const decoded = flagSet(tokens, "--decoded");
      if (raw && decoded) throw new UsageError("stream: choose --raw or --decoded, not both");
      const extra = positionals(tokens);
      if (extra.length !== 1) throw new UsageError("stream requires a ref");
      return { name: "stream", ref: extra[0]!, mode: raw ? "raw" : "decoded" };
    }
    case "find": {
      const type = optFlag(tokens, "--type");
      const where = optFlag(tokens, "--where");
      if (!type) throw new UsageError("find requires --type");
      return where === undefined ? { name: "find", type } : { name: "find", type, where };
    }
    case "tree": {
      const depthRaw = optFlag(tokens, "--depth");
      const extra = positionals(tokens);
      const depth = depthRaw === undefined ? undefined : Number(depthRaw);
      if (depthRaw !== undefined && !Number.isInteger(depth)) {
        throw new UsageError("tree --depth must be an integer");
      }
      const ref = extra[0];
      return {
        name: "tree",
        ...(ref === undefined ? {} : { ref }),
        ...(depth === undefined ? {} : { depth }),
      };
    }
    case "export_graph": {
      const from = optFlag(tokens, "--from");
      const depthRaw = optFlag(tokens, "--depth");
      const find = optFlag(tokens, "--find");
      const depth = depthRaw === undefined ? undefined : Number(depthRaw);
      if (depthRaw !== undefined && !Number.isInteger(depth)) {
        throw new UsageError("export_graph --depth must be an integer");
      }
      return {
        name: "export_graph",
        ...(from === undefined ? {} : { from }),
        ...(depth === undefined ? {} : { depth }),
        ...(find === undefined ? {} : { find }),
      };
    }
    default:
      throw new UsageError(`unknown command: ${cmd}`);
  }
}
