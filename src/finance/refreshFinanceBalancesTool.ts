import type { ToolDefinition, ToolResult } from "@/tools/toolTypes.ts";
import { requirePrivateChat } from "@/finance/requirePrivateChat.ts";
import { refreshPlaidBalances } from "@/finance/refreshPlaidBalances.ts";
import { accountBalances } from "@/finance/accountBalances.ts";
import { requireEnv } from "@/requireEnv.ts";
import { trace } from "@/trace.ts";

export const refreshFinanceBalancesTool: ToolDefinition = {
  schema: {
    name: "refresh_finance_balances",
    description:
      "Request real-time balances from Plaid and store them. Each successful call incurs a Plaid Balance fee. Call only when the user explicitly asks to refresh balances or requests a live balance now. Do not call for an ordinary balance question; use query_finances with account_balances for the daily stored balance.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    },
  },
  handle: handleRefreshFinanceBalances,
};

async function handleRefreshFinanceBalances(
  _input: Record<string, unknown>,
  traceId: string,
  telegramChatId?: number | null,
): Promise<ToolResult> {
  const refusal = requirePrivateChat(telegramChatId);
  if (refusal) return refusal;

  const response = await refreshPlaidBalances(requireEnv("PLAID_ACCESS_TOKEN"));
  await trace(traceId, "finance.balances_refreshed", {
    itemId: response.item.item_id,
    accounts: response.accounts.length,
  });

  return {
    content: JSON.stringify({
      operation: "refresh_finance_balances",
      changed: true,
      paidPlaidCall: true,
      instruction: "Report that Plaid supplied a new real-time balance.",
      balances: await accountBalances(),
    }),
  };
}
