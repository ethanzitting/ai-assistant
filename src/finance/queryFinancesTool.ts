import type { ToolDefinition, ToolResult } from "@/tools/toolTypes.ts";
import { parseToolInput } from "@/tools/parseToolInput.ts";
import { queryFinancesInputSchema, QUERY_TYPES } from "@/finance/queryFinancesSchema.ts";
import { requirePrivateChat } from "@/finance/requirePrivateChat.ts";
import { resolveDateRange } from "@/finance/resolveDateRange.ts";
import { financeFilters } from "@/finance/financeFilters.ts";
import { validateFilters } from "@/finance/validateFilters.ts";
import { spendingSummary } from "@/finance/spendingSummary.ts";
import { spendingByCategory } from "@/finance/spendingByCategory.ts";
import { spendingByMerchant } from "@/finance/spendingByMerchant.ts";
import { spendingTrends } from "@/finance/spendingTrends.ts";
import { accountBalances } from "@/finance/accountBalances.ts";
import { transactionSearch } from "@/finance/transactionSearch.ts";
import { trace } from "@/trace.ts";

export const queryFinancesTool: ToolDefinition = {
  schema: {
    name: "query_finances",
    description:
      "Query the user's bank transactions and balances, synced from Plaid. Use this for ANY question about spending, income, balances, or a specific charge — never query_knowledge, which holds no transaction data. This tool does the arithmetic and returns computed totals: report them as given and do not re-add or re-derive them.\n\nONE CALL IS USUALLY ENOUGH. \"How much did I spend on X, and how does that compare to last month?\" is a single spending_summary with categories and compare_to: previous_period — do NOT query two ranges separately and subtract. Do not repeat a call you already made.\n\nCategory names are lowercase and spelled out, e.g. 'food and drink' (not 'food & drink'), 'general merchandise', 'rent and utilities'. A filter naming something that does not exist is rejected and the valid names are listed — it is never reported as zero spending.\n\nAmounts are positive for money spent and negative for money received. Spending figures exclude transfers between the user's own accounts and credit card payments, so they reflect real spending. Dates default to the current calendar month; the range used is always stated in the result. Only checking and one credit card are linked, so this cannot see net worth or accounts elsewhere.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query_type: {
          type: "string",
          enum: [...QUERY_TYPES],
          description:
            "spending_summary: total, daily average, top categories. spending_by_category / spending_by_merchant: ranked breakdown. trends: month-by-month. account_balances: current balances. transaction_search: find specific transactions (the only type that includes income and transfers).",
        },
        start_date: { type: "string", description: "Start of range, YYYY-MM-DD." },
        end_date: { type: "string", description: "End of range, YYYY-MM-DD, inclusive." },
        categories: {
          type: "array",
          items: { type: "string" },
          description: "Filter to these categories, e.g. ['groceries']. Case-insensitive.",
        },
        merchants: {
          type: "array",
          items: { type: "string" },
          description: "Filter to these merchant names. Case-insensitive exact match.",
        },
        accounts: {
          type: "array",
          items: { type: "string" },
          description: "Filter to these account names, e.g. ['Checking'].",
        },
        search: {
          type: "string",
          description: "Free text matched against description and merchant. transaction_search only.",
        },
        compare_to: {
          type: "string",
          enum: ["previous_period", "same_period_last_year"],
          description: "Add a comparison figure. spending_summary only.",
        },
        limit: { type: "number", description: "Maximum rows for merchant and search results." },
      },
      required: ["query_type"],
    },
  },
  handle: handleQueryFinances,
};

async function handleQueryFinances(
  input: Record<string, unknown>,
  traceId: string,
  telegramChatId?: number | null,
): Promise<ToolResult> {
  const refusal = requirePrivateChat(telegramChatId);
  if (refusal) return refusal;

  const parsed = parseToolInput(
    queryFinancesInputSchema,
    input,
    '{ query_type: "spending_summary"|"spending_by_category"|"spending_by_merchant"|"account_balances"|"transaction_search"|"trends", start_date?: "YYYY-MM-DD", end_date?: "YYYY-MM-DD", categories?: ["groceries"], compare_to?: "previous_period" }',
  );
  if (!parsed.success) return parsed.error;

  const args = parsed.data;
  const range = resolveDateRange(args.start_date, args.end_date);
  const filters = financeFilters(range, args);

  const filterProblem = await validateFilters(filters);
  if (filterProblem) {
    await trace(traceId, "finance.query.bad_filter", { problem: filterProblem });
    return { content: filterProblem, isError: true };
  }

  await trace(traceId, "finance.query", { queryType: args.query_type, range });

  return { content: await runQuery(args, filters) };
}

async function runQuery(
  args: {
    query_type: typeof QUERY_TYPES[number];
    search?: string;
    limit?: number;
    compare_to?: "previous_period" | "same_period_last_year";
  },
  filters: ReturnType<typeof financeFilters>,
): Promise<string> {
  switch (args.query_type) {
    case "spending_summary":
      return await spendingSummary(filters, args.compare_to);
    case "spending_by_category":
      return await spendingByCategory(filters);
    case "spending_by_merchant":
      return await spendingByMerchant(filters, args.limit);
    case "trends":
      return await spendingTrends(filters);
    case "account_balances":
      return await accountBalances();
    case "transaction_search":
      return await transactionSearch(filters, args.search, args.limit);
  }
}
