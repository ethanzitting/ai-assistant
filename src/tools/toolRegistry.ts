import type { ToolUnion } from "@anthropic-ai/sdk/resources/messages.mjs";
import type { ToolDefinition, ToolHandler, ToolResult } from "@/tools/toolTypes.ts";
import { queryKnowledgeTool } from "@/knowledge/queryKnowledgeTool.ts";
import { searchArchivesTool } from "@/archive/searchArchivesTool.ts";
import { sendImageTool } from "@/archive/sendImageTool.ts";
import { rememberTool } from "@/knowledge/rememberTool.ts";
import { manageEventsTool } from "@/events/manageEventsTool.ts";
import { queryFinancesTool } from "@/finance/queryFinancesTool.ts";
import { setCategoryRuleTool } from "@/finance/setCategoryRuleTool.ts";
import { calendarTool } from "@/tools/calendarTool.ts";
import { messagingTool } from "@/telegram/messagingTool.ts";
import { error, warn } from "@/logger.ts";

let lastRememberTraceId: string | null = null;
let lastEventCreateTraceId: string | null = null;

const toolDefinitions: ToolDefinition[] = [
  queryKnowledgeTool,
  searchArchivesTool,
  sendImageTool,
  rememberTool,
  manageEventsTool,
  queryFinancesTool,
  setCategoryRuleTool,
  calendarTool,
  messagingTool,
];

const handlersByName = new Map<string, ToolHandler>(
  toolDefinitions.map((def) => [def.schema.name, def.handle]),
);

const serverTools: ToolUnion[] = [
  { type: "web_search_20250305", name: "web_search", max_uses: 5 },
];

export function getToolSchemas(): ToolUnion[] {
  const clientTools: ToolUnion[] = toolDefinitions.map((def) => def.schema);
  return [...clientTools, ...serverTools];
}

export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  traceId: string,
  telegramChatId?: number | null,
): Promise<ToolResult> {
  const gateResult = enforcePerTurnGates(toolName, toolInput, traceId);
  if (gateResult) return gateResult;

  const handler = handlersByName.get(toolName);

  if (!handler) {
    return { content: `Unknown tool: ${toolName}`, isError: true };
  }

  try {
    return await handler(toolInput, traceId, telegramChatId);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error("tool", "Tool execution failed", { toolName, error: errorMessage });
    return { content: `Tool error: ${errorMessage}`, isError: true };
  }
}

function enforcePerTurnGates(
  toolName: string,
  toolInput: Record<string, unknown>,
  traceId: string,
): ToolResult | null {
  if (toolName === "remember") {
    if (lastRememberTraceId === traceId) {
      warn("tool", "Blocked second remember call in same turn", { traceId });
      return {
        content: "remember already called this turn. Batch all items in one call. Do not retry.",
        isError: true,
      };
    }
    lastRememberTraceId = traceId;
  }

  if (toolName === "manage_events" && toolInput.action === "create") {
    if (lastEventCreateTraceId === traceId) {
      warn("tool", "Blocked second manage_events create in same turn", { traceId });
      return {
        content: "manage_events create already called this turn. Batch all events in one call. Do not retry.",
        isError: true,
      };
    }
    lastEventCreateTraceId = traceId;
  }

  return null;
}
