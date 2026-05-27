import Anthropic from "@anthropic-ai/sdk";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function callWithRetry<T>(apiFn: () => Promise<T>): Promise<T> {
  try {
    return await apiFn();
  } catch (error: unknown) {
    if (error instanceof Anthropic.RateLimitError) {
      const retryDelayMs = parseRetryDelay(error);
      console.warn(`Rate limited, retrying after ${retryDelayMs}ms`);
      await sleep(retryDelayMs);
      return apiFn();
    }

    if (error instanceof Anthropic.InternalServerError) {
      console.warn("Server error, retrying once after 2s");
      await sleep(2000);
      return apiFn();
    }

    if (error instanceof Anthropic.AuthenticationError) {
      console.error("Authentication failed — check ANTHROPIC_API_KEY");
    }

    throw error;
  }
}

function parseRetryDelay(error: InstanceType<typeof Anthropic.APIError>): number {
  const errorHeaders = error.headers as Record<string, string> | undefined;
  const retryAfterSeconds = parseInt(errorHeaders?.["retry-after"] ?? "5");
  return retryAfterSeconds * 1000;
}
