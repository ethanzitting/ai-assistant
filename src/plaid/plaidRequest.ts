import { requireEnv } from "@/requireEnv.ts";
import { fetchWithRetry } from "@/retry/fetchWithRetry.ts";
import { PlaidError } from "@/plaid/plaidError.ts";
import { PLAID_READ_ENDPOINTS, type PlaidReadEndpoint } from "@/plaid/plaidEndpoints.ts";

const REQUEST_TIMEOUT_MS = 30_000;

export async function plaidRequest<T>(
  endpoint: PlaidReadEndpoint,
  body: Record<string, unknown>,
): Promise<T> {
  assertReadEndpoint(endpoint);

  const response = await fetchWithRetry(`${plaidHost()}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: requireEnv("PLAID_CLIENT_ID"),
      secret: requireEnv("PLAID_SECRET"),
      ...body,
    }),
  }, { timeoutMs: REQUEST_TIMEOUT_MS });

  if (!response.ok) throw await toPlaidError(response, endpoint);

  return await response.json() as T;
}

// The type parameter already restricts callers, but a runtime check is what actually holds when the
// endpoint arrives from a variable or a future refactor loosens the type.
function assertReadEndpoint(endpoint: string): void {
  if ((PLAID_READ_ENDPOINTS as readonly string[]).includes(endpoint)) return;
  throw new Error(`Refusing to call Plaid endpoint outside the read allow-list: ${endpoint}`);
}

function plaidHost(): string {
  return `https://${requireEnv("PLAID_ENV")}.plaid.com`;
}

async function toPlaidError(response: Response, endpoint: string): Promise<Error> {
  const body = await response.text();

  try {
    const parsed = JSON.parse(body) as {
      error_type?: string;
      error_code?: string;
      error_message?: string;
    };
    if (parsed.error_code) {
      return new PlaidError(
        parsed.error_type ?? "UNKNOWN",
        parsed.error_code,
        parsed.error_message ?? `${endpoint} failed with ${parsed.error_code}`,
      );
    }
  } catch {
    // Fall through to the raw-body error below.
  }

  return new Error(`Plaid ${endpoint} failed (${response.status}): ${body}`);
}
