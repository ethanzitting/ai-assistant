#!/usr/bin/env -S deno run --allow-net --allow-env
//
// plaid-link — link a bank account once and print the access token.
//
// Host-side on purpose. It needs a browser, and it calls the three write-capable Plaid endpoints
// (token create, token get, public token exchange) that the agent is deliberately forbidden from
// reaching — see src/plaid/plaidEndpoints.ts. It therefore does not import the agent's Plaid client.
//
// Hosted Link is used rather than a local page because most large banks now require OAuth, which
// needs an HTTPS redirect URI registered in the Plaid dashboard. Plaid hosts the page instead, so
// there is nothing to register and the flow can be completed on a phone.
//
//   op run --env-file=.env.tpl -- deno run --allow-net --allow-env scripts/plaid-link.ts
//
// Requesting only `transactions` is what keeps the resulting token read-only. Do NOT add `auth`:
// it exposes the account and routing numbers, which transactions and balances never do.

const PRODUCTS = ["transactions"];

// Plaid defaults to 90 days and, per its docs, "once Transactions has been added to an Item, this
// value cannot be updated" — not by update mode, not by a new link token. Getting it wrong means
// removing the Item and linking again, so always ask for the 730-day maximum. Institutions return
// what they hold; asking for more than they have costs nothing.
const TRANSACTION_HISTORY_DAYS = 730;
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 15 * 60_000;

const clientId = requireEnv("PLAID_CLIENT_ID");
const secret = requireEnv("PLAID_SECRET");
const host = `https://${requireEnv("PLAID_ENV")}.plaid.com`;

const created = await plaidCall<{ link_token: string; hosted_link_url: string }>(
  "/link/token/create",
  {
    client_name: "Jarvis",
    language: "en",
    country_codes: ["US"],
    user: { client_user_id: "owner" },
    products: PRODUCTS,
    transactions: { days_requested: TRANSACTION_HISTORY_DAYS },
    hosted_link: {},
  },
);

if (!created.hosted_link_url) {
  console.error("Plaid returned no hosted_link_url. Hosted Link may not be enabled on this account.");
  Deno.exit(1);
}

console.log("\nOpen this URL and complete the bank login:\n");
console.log(`  ${created.hosted_link_url}\n`);
console.log("Waiting for the session to finish…");

const publicToken = await pollForPublicToken(created.link_token);

const exchanged = await plaidCall<{ access_token: string; item_id: string }>(
  "/item/public_token/exchange",
  { public_token: publicToken },
);

console.log("\nLinked. Store these in the ai.assistant 1Password vault BEFORE adding the");
console.log("reference to .env.tpl — op run fails closed on an unresolved reference.\n");
console.log(`  PLAID_ACCESS_TOKEN = ${exchanged.access_token}`);
console.log(`  item_id            = ${exchanged.item_id}\n`);

async function pollForPublicToken(linkToken: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const session = await plaidCall<LinkTokenGetResponse>("/link/token/get", {
      link_token: linkToken,
    });

    for (const linkSession of session.link_sessions ?? []) {
      const publicToken = linkSession.results?.item_add_results?.[0]?.public_token;
      if (publicToken) return publicToken;
    }
  }

  console.error("Timed out waiting for the Link session to finish.");
  Deno.exit(1);
}

interface LinkTokenGetResponse {
  link_sessions?: {
    finished_at?: string | null;
    results?: { item_add_results?: { public_token?: string }[] };
  }[];
}

async function plaidCall<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${host}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, secret, ...body }),
  });

  if (!response.ok) {
    console.error(`Plaid ${endpoint} failed (${response.status}): ${await response.text()}`);
    Deno.exit(1);
  }

  return await response.json() as T;
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (value) return value;
  console.error(`Missing required environment variable: ${name}`);
  return Deno.exit(1);
}
