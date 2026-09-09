import * as v from "valibot";
import { parseToolInput } from "@/tools/parseToolInput.ts";
import type { ToolDefinition, ToolResult } from "@/tools/toolTypes.ts";
import { requirePrivateChat } from "@/finance/requirePrivateChat.ts";
import { resolveDateRange } from "@/finance/resolveDateRange.ts";
import { startFinanceAudit } from "@/finance/startFinanceAudit.ts";
import { financeAuditStatus } from "@/finance/financeAuditStatus.ts";
import { sendNextFinanceAuditBatch } from "@/finance/sendNextFinanceAuditBatch.ts";
import { cancelFinanceAudit } from "@/finance/cancelFinanceAudit.ts";
import { trace } from "@/trace.ts";

const isoDate = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/));
const inputSchema = v.object({
  action: v.picklist(["start", "status", "send_next", "cancel"]),
  audit_id: v.optional(v.pipe(v.string(), v.uuid())),
  start_date: v.optional(isoDate),
  end_date: v.optional(isoDate),
});

export const manageFinanceAuditTool: ToolDefinition = {
  schema: {
    name: "manage_finance_audit",
    description:
      "Manage a historical transaction cleanup. 'start' queues every posted Unsorted expense in an exact date range and sends the first natural-language batch. 'status' reports progress. 'send_next' sends another batch. 'cancel' removes only unanswered audit items from the queue and keeps completed corrections.",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["start", "status", "send_next", "cancel"],
        },
        audit_id: {
          type: "string",
          description:
            "Optional audit UUID. Omit it for the active or latest audit.",
        },
        start_date: {
          type: "string",
          description: "Required for start. YYYY-MM-DD.",
        },
        end_date: {
          type: "string",
          description: "Required for start. YYYY-MM-DD.",
        },
      },
      required: ["action"],
    },
  },
  handle: handleFinanceAudit,
};

async function handleFinanceAudit(
  input: Record<string, unknown>,
  traceId: string,
  telegramChatId?: number | null,
): Promise<ToolResult> {
  const refusal = requirePrivateChat(telegramChatId);
  if (refusal) return refusal;

  const parsed = parseToolInput(
    inputSchema,
    input,
    '{ action: "start", start_date: "2026-06-01", end_date: "2026-08-31" }',
  );
  if (!parsed.success) return parsed.error;

  const { action, audit_id: auditId } = parsed.data;
  if (action === "start") {
    if (!parsed.data.start_date || !parsed.data.end_date) {
      return {
        content: "A finance audit needs a start_date and an end_date.",
        isError: true,
      };
    }
    const range = resolveDateRange(
      parsed.data.start_date,
      parsed.data.end_date,
    );
    const started = await startFinanceAudit(range.start, range.end);
    const sent = started.created && started.status.status === "active"
      ? await sendNextFinanceAuditBatch({
        auditId: started.status.auditId,
        chatId: telegramChatId as number,
      })
      : 0;
    await trace(traceId, "finance.audit.start", { ...started, sent });
    return {
      content: JSON.stringify({
        operation: "finance_audit_start",
        changed: started.created,
        reason: started.created ? undefined : "active_audit_exists",
        sent,
        ...started.status,
      }),
    };
  }

  const status = await financeAuditStatus(auditId);
  if (!status) return { content: "No finance audit exists.", isError: true };
  if (action === "status") return { content: JSON.stringify(status) };

  if (action === "send_next") {
    if (status.status !== "active") {
      return {
        content: `The finance audit is ${status.status}.`,
        isError: true,
      };
    }
    const sent = await sendNextFinanceAuditBatch({
      auditId: status.auditId,
      chatId: telegramChatId as number,
    });
    await trace(traceId, "finance.audit.send_next", {
      auditId: status.auditId,
      sent,
    });
    return {
      content: JSON.stringify({
        operation: "finance_audit_send_next",
        changed: sent > 0,
        sent,
        ...status,
      }),
    };
  }

  const restored = await cancelFinanceAudit(status.auditId);
  await trace(traceId, "finance.audit.cancel", {
    auditId: status.auditId,
    restored,
  });
  return {
    content: JSON.stringify({
      operation: "finance_audit_cancel",
      changed: status.status === "active",
      restoredToPriorQueueState: restored,
      resolvedItemsKept: status.completed,
    }),
  };
}
