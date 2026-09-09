import { db } from "@/db.ts";
import type { ToolDefinition, ToolResult } from "@/tools/toolTypes.ts";
import { requirePrivateChat } from "@/finance/requirePrivateChat.ts";
import { formatMoney } from "@/finance/formatMoney.ts";

const MAX_ROWS = 25;

interface PendingRow {
  id: string;
  posted_date: Date;
  amount: number;
  merchant_name: string | null;
  description: string;
  total_count: number;
}

export const listPendingCategorizationsTool: ToolDefinition = {
  schema: {
    name: "list_pending_categorizations",
    description:
      "Get the current category queue. Returns the full queue count and up to 25 recent posted expenses. Use this outside a batch reply. A batch reply already contains exact transaction IDs.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  handle: handleListPending,
};

async function handleListPending(
  _input: Record<string, unknown>,
  _traceId: string,
  telegramChatId?: number | null,
): Promise<ToolResult> {
  const refusal = requirePrivateChat(telegramChatId);
  if (refusal) return refusal;

  const rows = await db`
    SELECT t.id, t.posted_date, t.amount, t.merchant_name, t.description,
      count(*) OVER ()::int AS total_count
    FROM transactions t
    WHERE t.needs_category AND t.transaction_type = 'expense'
      AND NOT t.pending AND t.removed_at IS NULL
    ORDER BY t.posted_date DESC
    LIMIT ${MAX_ROWS}
  ` as unknown as PendingRow[];

  if (rows.length === 0) {
    return {
      content: JSON.stringify({
        operation: "list_pending_categorizations",
        changed: false,
        total: 0,
        shown: 0,
        truncated: false,
        transactions: [],
      }),
    };
  }

  const total = rows[0].total_count;
  const transactions = rows.map((row) => ({
    transactionId: row.id,
    postedDate: row.posted_date.toISOString().slice(0, 10),
    amount: row.amount,
    formattedAmount: formatMoney(row.amount),
    merchant: row.merchant_name ?? row.description,
  }));

  return {
    content: JSON.stringify({
      operation: "list_pending_categorizations",
      changed: false,
      total,
      shown: rows.length,
      truncated: total > rows.length,
      transactions,
    }),
  };
}
