import type { Tool } from "@/anthropic/mod.ts";
import type { ToolDefinition, ToolHandler, ToolResult } from "@/tools/types.ts";
import { queryKnowledge } from "@/tools/query-knowledge.ts";
import { remember } from "@/tools/remember.ts";
import { manageEvents } from "@/tools/manage-events.ts";
import { getCalendar } from "@/tools/get-calendar.ts";
import { fetchSkill } from "@/tools/fetch-skill.ts";
import { sendMessage } from "@/tools/send-message.ts";

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
