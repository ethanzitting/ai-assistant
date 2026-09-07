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
}

export const listPendingCategorizationsTool: ToolDefinition = {
  schema: {
    name: "list_pending_categorizations",
    description:
      "List charges still waiting for a category. Call this when the user answers a categorization question in text, or sends a receipt photo — you need the transaction_id before you can call split_transaction. Match a receipt to a charge by its TOTAL amount; if no pending charge matches the receipt total, say so rather than guessing at the nearest one.",
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
    SELECT t.id, t.posted_date, t.amount, t.merchant_name, t.description
    FROM transactions t
    WHERE t.needs_category AND NOT t.pending AND t.removed_at IS NULL
    ORDER BY t.posted_date DESC
    LIMIT ${MAX_ROWS}
  ` as unknown as PendingRow[];

  if (rows.length === 0) return { content: "Nothing is waiting for a category." };

  const lines = rows.map((row) =>
    `${row.posted_date.toISOString().slice(0, 10)}  ${formatMoney(row.amount)}  ${
      row.merchant_name ?? row.description
    }  [${row.id}]`
  );

  return { content: `${rows.length} awaiting a category:\n${lines.join("\n")}` };
}
