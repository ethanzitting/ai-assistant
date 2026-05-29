import type { Tool } from "@anthropic-ai/sdk/resources/messages.mjs";

export interface ToolResult {
  content: string;
  isError?: boolean;
}

export type ToolHandler = (input: Record<string, unknown>, traceId: string) => Promise<ToolResult>;

export interface ToolDefinition {
  schema: Tool;
  handle: ToolHandler;
}
