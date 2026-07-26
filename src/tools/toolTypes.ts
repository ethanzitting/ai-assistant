import type { Tool } from "@anthropic-ai/sdk/resources/messages.mjs";

export interface ToolResult {
  content: string;
  isError?: boolean;
}

// telegramChatId is the chat the current turn came from, so a tool that sends something can reply
// where it was asked instead of defaulting to the owner's private chat.
export type ToolHandler = (
  input: Record<string, unknown>,
  traceId: string,
  telegramChatId?: number | null,
) => Promise<ToolResult>;

export interface ToolDefinition {
  schema: Tool;
  handle: ToolHandler;
}
