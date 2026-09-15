export type McpStdioInvocation = {
  label: string;
  command: string;
  args: string[];
};

export function shouldAdvertiseMcp(pdfPath: string | undefined): boolean {
  return typeof pdfPath === "string" && pdfPath.length > 0;
}

export function mcpStdioInvocation(nodeExecutable: string, scriptPath: string, pdfPath: string): McpStdioInvocation {
  return {
    label: "Muin",
    command: nodeExecutable,
    args: [scriptPath, pdfPath],
  };
}
