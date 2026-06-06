import Anthropic from "@anthropic-ai/sdk";
import { warn, error } from "@/logger.ts";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function callWithRetry<T>(apiFn: () => Promise<T>): Promise<T> {
  try {
    return await apiFn();
  } catch (err: unknown) {
    if (err instanceof Anthropic.RateLimitError) {
      const retryDelayMs = parseRetryDelay(err);
      warn("anthropic", "Rate limited, retrying", { delayMs: retryDelayMs });
      await sleep(retryDelayMs);
      return apiFn();
    }

    if (err instanceof Anthropic.InternalServerError) {
      warn("anthropic", "Server error, retrying after 2s");
      await sleep(2000);
      return apiFn();
    }

    if (err instanceof Anthropic.APIConnectionError) {
      warn("anthropic", "Connection error, retrying after 2s");
      await sleep(2000);
      return apiFn();
    }

    if (err instanceof Anthropic.AuthenticationError) {
      error("anthropic", "Authentication failed — check ANTHROPIC_API_KEY");
    }

    throw err;
  }
}

function parseRetryDelay(err: InstanceType<typeof Anthropic.APIError>): number {
  const errorHeaders = err.headers as Record<string, string> | undefined;
  const retryAfterSeconds = parseInt(errorHeaders?.["retry-after"] ?? "5");
  return retryAfterSeconds * 1000;
}
