export type TransactionType = "expense" | "income" | "transfer";

const TRANSFER_PRIMARIES = new Set(["TRANSFER_IN", "TRANSFER_OUT"]);

// A credit card payment moves money between two accounts you already own. Plaid files it under
// LOAN_PAYMENTS rather than TRANSFER, so without this it counts as spending on top of the card
// purchases it settles, and every total is inflated by roughly a month of card use. Other loan
// payments — mortgage, auto, student — stay expenses.
const TRANSFER_DETAILED = new Set(["LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"]);

export interface ClassifyTransactionTypeArgs {
  plaidCategoryPrimary: string | null;
  plaidCategoryDetailed: string | null;
  amount: number;
}

export function classifyTransactionType(args: ClassifyTransactionTypeArgs): TransactionType {
  if (args.plaidCategoryDetailed && TRANSFER_DETAILED.has(args.plaidCategoryDetailed)) {
    return "transfer";
  }
  if (args.plaidCategoryPrimary && TRANSFER_PRIMARIES.has(args.plaidCategoryPrimary)) {
    return "transfer";
  }
  if (args.plaidCategoryPrimary === "INCOME") return "income";

  // No category from Plaid: fall back to the sign. Plaid uses a negative amount for money
  // arriving in the account.
  if (!args.plaidCategoryPrimary) return args.amount < 0 ? "income" : "expense";

  return "expense";
}
