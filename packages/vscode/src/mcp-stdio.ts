import { createSession, serveMcpStdio } from "@muin/core";

const file = process.argv[2];
if (!file) {
  process.stderr.write("usage: mcp-stdio.js <file.pdf>\n");
  process.exit(2);
}

const session = await createSession(file);
await serveMcpStdio(session);
