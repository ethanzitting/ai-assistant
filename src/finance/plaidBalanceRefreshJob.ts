import { refreshPlaidBalances } from "@/finance/refreshPlaidBalances.ts";
import { info } from "@/logger.ts";

export async function plaidBalanceRefreshJob(): Promise<
  Record<string, unknown>
> {
  const accessToken = Deno.env.get("PLAID_ACCESS_TOKEN");
  if (!accessToken) {
    info(
      "finance",
      "Plaid balance refresh skipped — no PLAID_ACCESS_TOKEN set",
    );
    return { skipped: "no_access_token" };
  }

  const response = await refreshPlaidBalances(accessToken);

  return {
    itemId: response.item.item_id,
    accounts: response.accounts.length,
  };
}
