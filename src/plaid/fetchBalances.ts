import { plaidRequest } from "@/plaid/plaidRequest.ts";

export interface PlaidAccount {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  balances: {
    available: number | null;
    current: number | null;
    limit: number | null;
    iso_currency_code: string | null;
  };
}

export interface BalancesResponse {
  accounts: PlaidAccount[];
  item: {
    item_id: string;
    institution_id: string | null;
    institution_name?: string | null;
  };
}

export function fetchBalances(accessToken: string): Promise<BalancesResponse> {
  return plaidRequest<BalancesResponse>("/accounts/balance/get", {
    access_token: accessToken,
  });
}
