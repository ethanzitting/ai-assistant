import type { Tool } from "@/anthropic/anthropicExports.ts";

export interface ToolResult {
  content: string;
  isError?: boolean;
}

export type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

export interface ToolDefinition {
  schema: Tool;
  handle: ToolHandler;
}
