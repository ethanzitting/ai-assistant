import { withRetry, type RetryOptions } from "@/retry/withRetry.ts";
import { HttpError } from "@/retry/httpError.ts";
import { warn } from "@/logger.ts";

// Statuses worth retrying. The only 4xx here are the transient ones — 408 (request timeout),
// 425 (too early), 429 (rate limited, usually with Retry-After). General client errors
// (400/401/403/404/422) are deliberately absent: they won't change on retry, so fetchWithRetry
// returns them as a Response for the caller to inspect via res.ok. This set differs from
// uploadToB2's, which also retries 401 because B2 expires upload tokens — see the note there.
const DEFAULT_RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface FetchRetryOptions extends RetryOptions<Response> {
  /**
   * Per-attempt timeout in ms. A fresh AbortSignal.timeout is created for each try, so
   * retries aren't poisoned by a stale, already-fired signal (the trap of putting
   * AbortSignal.timeout directly in `init`, which is reused across attempts).
   */
  timeoutMs?: number;
}

/**
 * fetch() with retries baked in.
 * - Throws + retries on retryable status codes, network errors, and per-attempt timeouts.
 * - Returns the Response as-is for non-retryable non-2xx (401, 404, …) so the caller can
 *   inspect `res.ok` and surface a detailed error.
 *
 * NOTE: a streaming request body can't be replayed — pass a re-sendable body (string,
 * Uint8Array, ArrayBuffer), not a ReadableStream, for retries to work.
 */
export function fetchWithRetry(
  input: string | URL | Request,
  init: RequestInit = {},
  options: FetchRetryOptions = {},
): Promise<Response> {
  const { timeoutMs, ...retryOptions } = options;
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;
  const onRetry = options.onRetry ?? makeDefaultOnRetry(input);

  return withRetry<Response>(async () => {
    const signal = buildAttemptSignal(init.signal ?? undefined, options.signal, timeoutMs);
    const response = await fetch(input, signal ? { ...init, signal } : init);
    if (!response.ok && DEFAULT_RETRYABLE_STATUS.has(response.status)) {
      throw new HttpError(response, parseRetryAfter(response.headers.get("retry-after")));
    }
    return response;
  }, { ...retryOptions, shouldRetry, onRetry });
}

function defaultShouldRetry(error: unknown): boolean {
  if (error instanceof HttpError) return DEFAULT_RETRYABLE_STATUS.has(error.status);
  if (error instanceof TypeError) return true; // fetch surfaces network failures as TypeError
  if (error instanceof DOMException && error.name === "TimeoutError") return true; // per-attempt timeout
  return false;
}

function makeDefaultOnRetry(input: string | URL | Request) {
  return (error: unknown, attempt: number, delayMs: number) => {
    warn("http", "Retrying request", {
      url: requestUrl(input),
      attempt,
      delayMs: Math.round(delayMs),
      error: error instanceof Error ? error.message : String(error),
    });
  };
}

// Combine the caller's request signal, the overall loop signal, and a fresh per-attempt
// timeout into one. Created inside the retry body so each attempt gets a new timeout.
function buildAttemptSignal(
  initSignal: AbortSignal | undefined,
  loopSignal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): AbortSignal | undefined {
  const signals: AbortSignal[] = [];
  if (initSignal) signals.push(initSignal);
  if (loopSignal) signals.push(loopSignal);
  if (timeoutMs != null) signals.push(AbortSignal.timeout(timeoutMs));

  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  return AbortSignal.any(signals);
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Retry-After may be a number of seconds or an HTTP date. */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}
