import { plaidRequest } from "@/plaid/plaidRequest.ts";
import type { PlaidAccountsResponse } from "@/plaid/fetchAccounts.ts";

export function fetchBalances(
  accessToken: string,
): Promise<PlaidAccountsResponse> {
  return plaidRequest<PlaidAccountsResponse>("/accounts/balance/get", {
    access_token: accessToken,
  });
}
