import { jsonSchema, tool, type ToolSet } from "ai";
import type {
  ToolDefinition,
  ToolHandler,
  ToolResult,
} from "@/tools/toolTypes.ts";
import { queryKnowledgeTool } from "@/knowledge/queryKnowledgeTool.ts";
import { searchArchivesTool } from "@/archive/searchArchivesTool.ts";
import { sendImageTool } from "@/archive/sendImageTool.ts";
import { rememberTool } from "@/knowledge/rememberTool.ts";
import { manageEventsTool } from "@/events/manageEventsTool.ts";
import { queryFinancesTool } from "@/finance/queryFinancesTool.ts";
import { splitTransactionTool } from "@/finance/splitTransactionTool.ts";
import { listPendingCategorizationsTool } from "@/finance/listPendingCategorizationsTool.ts";
import { setVendorPolicyTool } from "@/finance/setVendorPolicyTool.ts";
import { categorizeTransactionsTool } from "@/finance/categorizeTransactionsTool.ts";
import { manageFinanceAuditTool } from "@/finance/manageFinanceAuditTool.ts";
import { createFinanceCategoryTool } from "@/finance/createFinanceCategoryTool.ts";
import {
  confirmReceiptMatchTool,
  getReceiptContentTool,
  listReceiptMatchesTool,
  recordReceiptTool,
} from "@/finance/receiptTools.ts";
import { calendarTool } from "@/tools/calendarTool.ts";
import { messagingTool } from "@/telegram/messagingTool.ts";
import { createSuccessfulCallGate } from "@/tools/createSuccessfulCallGate.ts";
import { error, warn } from "@/logger.ts";

const MAX_SUCCESSFUL_WRITE_CALLS = 3;
const rememberGate = createSuccessfulCallGate(MAX_SUCCESSFUL_WRITE_CALLS);
const eventCreateGate = createSuccessfulCallGate(MAX_SUCCESSFUL_WRITE_CALLS);

const toolDefinitions: ToolDefinition[] = [
  queryKnowledgeTool,
  searchArchivesTool,
  sendImageTool,
  rememberTool,
  manageEventsTool,
  queryFinancesTool,
  splitTransactionTool,
  listPendingCategorizationsTool,
  setVendorPolicyTool,
  categorizeTransactionsTool,
  manageFinanceAuditTool,
  createFinanceCategoryTool,
  recordReceiptTool,
  listReceiptMatchesTool,
  confirmReceiptMatchTool,
  getReceiptContentTool,
  calendarTool,
  messagingTool,
];

const handlersByName = new Map<string, ToolHandler>(
  toolDefinitions.map((def) => [def.schema.name, def.handle]),
);

export function getToolSchemas(): ToolSet {
  return Object.fromEntries(toolDefinitions.map((definition) => [
    definition.schema.name,
    tool({
      description: definition.schema.description,
      inputSchema: jsonSchema(definition.schema.inputSchema as never),
      outputSchema: jsonSchema({ type: "string" }),
    }),
  ]));
}

export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  traceId: string,
  telegramChatId?: number | null,
): Promise<ToolResult> {
  const gate = selectGate(toolName, toolInput);
  const gateResult = enforcePerTurnGate(gate, toolName, traceId);
  if (gateResult) return gateResult;

  const handler = handlersByName.get(toolName);

  if (!handler) {
    return { content: `Unknown tool: ${toolName}`, isError: true };
  }

  try {
    const result = await handler(toolInput, traceId, telegramChatId);
    if (!result.isError) gate?.recordSuccess(traceId);
    return result;
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error("tool", "Tool execution failed", { toolName, error: errorMessage });
    return { content: `Tool error: ${errorMessage}`, isError: true };
  }
}

interface SuccessfulCallGate {
  isBlocked(traceId: string): boolean;
  recordSuccess(traceId: string): void;
}

function selectGate(
  toolName: string,
  toolInput: Record<string, unknown>,
): SuccessfulCallGate | null {
  if (toolName === "remember") return rememberGate;
  if (toolName === "manage_events" && toolInput.action === "create") {
    return eventCreateGate;
  }
  return null;
}

function enforcePerTurnGate(
  gate: SuccessfulCallGate | null,
  toolName: string,
  traceId: string,
): ToolResult | null {
  if (!gate?.isBlocked(traceId)) return null;

  warn("tool", "Blocked tool after successful call limit", {
    traceId,
    toolName,
    maxSuccessfulCalls: MAX_SUCCESSFUL_WRITE_CALLS,
  });
  return {
    content: JSON.stringify({
      operation: toolName,
      changed: false,
      reason: "successful_call_limit_reached",
      maxSuccessfulCalls: MAX_SUCCESSFUL_WRITE_CALLS,
      instruction: "Do not call this operation again during this turn.",
    }),
    isError: true,
  };
}
