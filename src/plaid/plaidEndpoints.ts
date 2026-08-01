// Plaid issues no scoped API keys: one client_id/secret pair reaches every endpoint the account is
// enabled for, including money movement if Transfer is ever enabled. Dashboard product settings are
// the primary guard; this list is the code-level half. plaidRequest refuses any path outside it, so
// no later edit can reach a write endpoint by accident.
//
// The one-time Link flow (scripts/plaid-link.ts) deliberately does NOT use plaidRequest. Token
// creation and exchange stay outside the agent entirely.
export const PLAID_READ_ENDPOINTS = [
  "/accounts/balance/get",
  "/transactions/sync",
] as const;

export type PlaidReadEndpoint = typeof PLAID_READ_ENDPOINTS[number];
