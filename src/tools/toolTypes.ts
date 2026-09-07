export interface ToolResult {
  content: string;
  isError?: boolean;
}

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// telegramChatId is the chat the current turn came from, so a tool that sends something can reply
// where it was asked instead of defaulting to the owner's private chat.
export type ToolHandler = (
  input: Record<string, unknown>,
  traceId: string,
  telegramChatId?: number | null,
) => Promise<ToolResult>;

export interface ToolDefinition {
  schema: ToolSchema;
  handle: ToolHandler;
}
