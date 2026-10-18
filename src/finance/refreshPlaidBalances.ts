import { fetchBalances } from "@/plaid/fetchBalances.ts";
import { upsertAccounts } from "@/finance/upsertAccounts.ts";
import type { PlaidAccountsResponse } from "@/plaid/fetchAccounts.ts";

export async function refreshPlaidBalances(
  accessToken: string,
): Promise<PlaidAccountsResponse> {
  const response = await fetchBalances(accessToken);
  await upsertAccounts({ response, updateBalances: true });
  return response;
}
