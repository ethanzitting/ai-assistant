import * as v from "valibot";
import { applyTransactionCategories } from "@/finance/applyTransactionCategories.ts";
import { parseToolInput } from "@/tools/parseToolInput.ts";
import type { ToolDefinition, ToolResult } from "@/tools/toolTypes.ts";
import { requirePrivateChat } from "@/finance/requirePrivateChat.ts";
import { trace } from "@/trace.ts";

const inputSchema = v.object({
  transactions: v.pipe(
    v.array(v.object({
      transaction_id: v.pipe(v.string(), v.uuid()),
      category: v.pipe(v.string(), v.minLength(2)),
    })),
    v.minLength(1),
  ),
});

export const categorizeTransactionsTool: ToolDefinition = {
  schema: {
    name: "categorize_transactions",
    description:
      "Apply one-time categories to exact posted expense transactions. This tool never creates a merchant rule. Batch all clear answers into one call. Use transaction IDs from a finance batch, list_pending_categorizations, or query_finances. Category names are case-insensitive. Use split_transaction instead for a split.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transactions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              transaction_id: { type: "string" },
              category: { type: "string" },
            },
            required: ["transaction_id", "category"],
          },
        },
      },
      required: ["transactions"],
    },
  },
  handle: handleCategorizeTransactions,
};

async function handleCategorizeTransactions(
  input: Record<string, unknown>,
  traceId: string,
  telegramChatId?: number | null,
): Promise<ToolResult> {
  const refusal = requirePrivateChat(telegramChatId);
  if (refusal) return refusal;

  const parsed = parseToolInput(
    inputSchema,
    input,
    '{ transactions: [{ transaction_id: "uuid", category: "Groceries" }] }',
  );
  if (!parsed.success) return parsed.error;

  const result = await applyTransactionCategories(
    parsed.data.transactions.map((transaction) => ({
      transactionId: transaction.transaction_id,
      category: transaction.category,
    })),
  );
  await trace(traceId, "finance.transactions_categorized", { ...result });
  if (!result.ok) {
    return {
      content: JSON.stringify({
        operation: "categorize_transactions",
        changed: false,
        reason: result.problem,
      }),
      isError: true,
    };
  }

  return {
    content: JSON.stringify({
      operation: "categorize_transactions",
      changed: true,
      transactionsChanged: result.assignments?.length ?? 0,
      queueItemsClosed: result.queueItemsClosed,
      assignments: result.assignments,
    }),
  };
}
