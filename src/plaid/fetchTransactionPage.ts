import { plaidRequest } from "@/plaid/plaidRequest.ts";

const PAGE_SIZE = 500;

export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  // Positive when money leaves the account, negative when it arrives. Kept unchanged everywhere.
  amount: number;
  iso_currency_code: string | null;
  date: string;
  authorized_date: string | null;
  name: string;
  merchant_name: string | null;
  pending: boolean;
  pending_transaction_id: string | null;
  payment_channel: string | null;
  personal_finance_category: { primary: string; detailed: string } | null;
}

export interface RemovedTransaction {
  transaction_id: string;
}

export interface TransactionPage {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: RemovedTransaction[];
  next_cursor: string;
  has_more: boolean;
}

// One page only. The caller drives the loop, because each page and its cursor must commit together
// before the next page is requested — see applyTransactionPage.
export function fetchTransactionPage(
  accessToken: string,
  cursor: string | null,
): Promise<TransactionPage> {
  return plaidRequest<TransactionPage>("/transactions/sync", {
    access_token: accessToken,
    cursor: cursor ?? undefined,
    count: PAGE_SIZE,
  });
}
