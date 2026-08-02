export type TransactionType = "expense" | "income" | "transfer";

// LOAN_DISBURSEMENTS is where Plaid files the credit-card side of a card payment — it arrives on
// the card account as "Payment Thank You" with a negative amount. Left as an expense it does not
// merely fail to count, it actively subtracts: $29,645 of card payments were reducing a two-year
// spending total rather than being excluded from it. A genuine loan disbursement lands here too,
// and transfer is right for that as well — borrowed money is neither earned nor spent.
const TRANSFER_PRIMARIES = new Set(["TRANSFER_IN", "TRANSFER_OUT", "LOAN_DISBURSEMENTS"]);

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
