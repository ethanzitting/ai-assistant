import type { Tool } from "@/anthropic/anthropicExports.ts";
import type { ToolDefinition, ToolHandler, ToolResult } from "@/tools/toolTypes.ts";
import { queryKnowledge } from "@/knowledge/queryKnowledgeTool.ts";
import { remember } from "@/knowledge/rememberTool.ts";
import { manageEvents } from "@/events/manageEventsTool.ts";
import { getCalendar } from "@/tools/calendarTool.ts";
import { fetchSkill } from "@/tools/skillTool.ts";
import { sendMessage } from "@/tools/messagingTool.ts";

const toolDefinitions: ToolDefinition[] = [
  queryKnowledge,
  remember,
  manageEvents,
  getCalendar,
  fetchSkill,
  sendMessage,
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
): Promise<ToolResult> {
  const handler = handlersByName.get(toolName);

  if (!handler) {
    return { content: `Unknown tool: ${toolName}`, isError: true };
  }

  try {
    return await handler(toolInput);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Tool "${toolName}" failed:`, errorMessage);
    return { content: `Tool error: ${errorMessage}`, isError: true };
  }
}
