import type { PlaidTransaction } from "@/plaid/fetchTransactionPage.ts";
import { resolveCategory, type CategoryRule } from "@/finance/resolveCategory.ts";
import { classifyTransactionType } from "@/finance/classifyTransactionType.ts";

export interface TransactionRow {
  plaid_transaction_id: string;
  account_id: string;
  posted_date: string;
  authorized_date: string | null;
  amount: number;
  currency_code: string | null;
  description: string;
  merchant_name: string | null;
  plaid_category_primary: string | null;
  plaid_category_detailed: string | null;
  category: string | null;
  category_source: string | null;
  transaction_type: string;
  payment_channel: string | null;
  pending: boolean;
  source: string;
  properties: Record<string, unknown>;
}

export interface ToTransactionRowArgs {
  transaction: PlaidTransaction;
  accountId: string;
  rules: CategoryRule[];
}

export function toTransactionRow(args: ToTransactionRowArgs): TransactionRow {
  const { transaction } = args;
  const plaidCategoryPrimary = transaction.personal_finance_category?.primary ?? null;
  const plaidCategoryDetailed = transaction.personal_finance_category?.detailed ?? null;

  const resolved = resolveCategory({
    merchantName: transaction.merchant_name,
    description: transaction.name,
    plaidCategoryPrimary,
    rules: args.rules,
  });

  return {
    plaid_transaction_id: transaction.transaction_id,
    account_id: args.accountId,
    posted_date: transaction.date,
    authorized_date: transaction.authorized_date,
    amount: transaction.amount,
    currency_code: transaction.iso_currency_code,
    description: transaction.name,
    merchant_name: transaction.merchant_name,
    plaid_category_primary: plaidCategoryPrimary,
    plaid_category_detailed: plaidCategoryDetailed,
    category: resolved.category,
    category_source: resolved.source,
    transaction_type: classifyTransactionType({
      plaidCategoryPrimary,
      plaidCategoryDetailed,
      amount: transaction.amount,
    }),
    payment_channel: transaction.payment_channel,
    pending: transaction.pending,
    source: "plaid",
    properties: transaction.pending_transaction_id
      ? { pending_transaction_id: transaction.pending_transaction_id }
      : {},
  };
}
