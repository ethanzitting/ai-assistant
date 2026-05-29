import type { Tool } from "@anthropic-ai/sdk/resources/messages.mjs";
import type { ToolDefinition, ToolHandler, ToolResult } from "@/tools/toolTypes.ts";
import { queryKnowledgeTool } from "@/knowledge/queryKnowledgeTool.ts";
import { rememberTool } from "@/knowledge/rememberTool.ts";
import { manageEventsTool } from "@/events/manageEventsTool.ts";
import { calendarTool } from "@/tools/calendarTool.ts";
import { skillTool } from "@/tools/skillTool.ts";
import { messagingTool } from "@/telegram/messagingTool.ts";
import { error } from "@/logger.ts";

const toolDefinitions: ToolDefinition[] = [
  queryKnowledgeTool,
  rememberTool,
  manageEventsTool,
  calendarTool,
  skillTool,
  messagingTool,
];

const handlersByName = new Map<string, ToolHandler>(
  toolDefinitions.map((def) => [def.schema.name, def.handle]),
);

export function getToolSchemas(): Tool[] {
  return toolDefinitions.map((def) => def.schema);
}

export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  traceId: string,
): Promise<ToolResult> {
  const handler = handlersByName.get(toolName);

  if (!handler) {
    return { content: `Unknown tool: ${toolName}`, isError: true };
  }

  try {
    return await handler(toolInput, traceId);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error("tool", "Tool execution failed", { toolName, error: errorMessage });
    return { content: `Tool error: ${errorMessage}`, isError: true };
  }
}
