export type McpStdioInvocation = {
  label: string;
  command: string;
  args: string[];
};

export function mcpStdioInvocation(nodeExecutable: string, scriptPath: string): McpStdioInvocation {
  return {
    label: "Muin",
    command: nodeExecutable,
    args: [scriptPath],
  };
}
