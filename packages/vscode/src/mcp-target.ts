import { MUIN_FOCUSED_PDF_FILE } from "@muin/core";

export { MUIN_FOCUSED_PDF_FILE };

export type McpStdioInvocation = {
  label: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
};

export function mcpStdioInvocation(
  nodeExecutable: string,
  scriptPath: string,
  extraEnv?: Record<string, string>,
): McpStdioInvocation {
  const inv: McpStdioInvocation = {
    label: "Muin",
    command: nodeExecutable,
    args: [scriptPath],
  };
  if (extraEnv) inv.env = extraEnv;
  return inv;
}
