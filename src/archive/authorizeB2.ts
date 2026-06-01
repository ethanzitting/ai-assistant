import { requireEnv } from "@/requireEnv.ts";

const B2_AUTH_URL = "https://api.backblazeb2.com/b2api/v2/b2_authorize_account";

interface B2Auth {
  authorizationToken: string;
  apiUrl: string;
  authorizedAt: number;
}

let cached: B2Auth | null = null;

const TOKEN_TTL_MS = 23 * 60 * 60 * 1000; // 23 hours (tokens valid for 24)

export async function authorizeB2(): Promise<B2Auth> {
  if (cached && Date.now() - cached.authorizedAt < TOKEN_TTL_MS) {
    return cached;
  }

  const keyId = requireEnv("B2_KEY_ID");
  const appKey = requireEnv("B2_APPLICATION_KEY");

  const response = await fetch(B2_AUTH_URL, {
    method: "GET",
    headers: {
      Authorization: `Basic ${btoa(`${keyId}:${appKey}`)}`,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`B2 authorization failed (${response.status}): ${body}`);
  }

  const data = await response.json();

  cached = {
    authorizationToken: data.authorizationToken,
    apiUrl: data.apiUrl,
    authorizedAt: Date.now(),
  };

  return cached;
}

export function clearB2AuthCache(): void {
  cached = null;
}
