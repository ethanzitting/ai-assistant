import { HttpError } from "@/retry/httpError.ts";

export interface RetryOptions<T> {
  /** Max retry attempts AFTER the initial try. Default: 3 (so up to 4 total). */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff. Default: 300. */
  baseDelayMs?: number;
  /** Cap on any single delay in ms. Default: 10_000. */
  maxDelayMs?: number;
  /** Backoff multiplier applied per attempt. Default: 2. */
  factor?: number;
  /** Full jitter (delay becomes random in [0, computed]) to avoid synchronized retries. Default: true. */
  jitter?: boolean;
  /**
   * Decide whether a thrown error warrants a retry. Return false to give up immediately
   * (e.g. a 400 that won't succeed on retry). `attempt` is 0-indexed. Default: retry on everything.
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean | Promise<boolean>;
  /** Fired before each backoff sleep — for logging / metrics / cache invalidation. */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void | Promise<void>;
  /** Fired once after all retries are exhausted, before the error propagates. */
  onFailure?: (error: unknown, attempts: number) => void | Promise<void>;
  /** If provided, its return value is returned instead of throwing once retries are exhausted. */
  fallback?: (error: unknown) => T | Promise<T>;
  /** Abort the entire retry loop (e.g. an overall deadline). */
  signal?: AbortSignal;
}

// Run `fn`, retrying on failure per `options`. `fn` receives the 0-indexed attempt number.
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions<T> = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 300,
    maxDelayMs = 10_000,
    factor = 2,
    jitter = true,
    shouldRetry = () => true,
    onRetry,
    onFailure,
    fallback,
    signal,
  } = options;

  let attempt = 0;
  while (true) {
    signal?.throwIfAborted();
    try {
      return await fn(attempt);
    } catch (error) {
      const isLastAttempt = attempt >= maxRetries;
      const retryable = !isLastAttempt && (await shouldRetry(error, attempt));

      if (!retryable) {
        await onFailure?.(error, attempt + 1);
        if (fallback) return await fallback(error);
        throw error;
      }

      const delayMs = computeDelay(attempt, { baseDelayMs, maxDelayMs, factor, jitter }, error);
      await onRetry?.(error, attempt + 1, delayMs);
      await sleep(delayMs, signal);
      attempt++;
    }
  }
}

function computeDelay(
  attempt: number,
  opts: { baseDelayMs: number; maxDelayMs: number; factor: number; jitter: boolean },
  error?: unknown,
): number {
  // A server-supplied Retry-After always wins — don't out-guess the origin.
  if (error instanceof HttpError && error.retryAfterMs != null) {
    return Math.min(error.retryAfterMs, opts.maxDelayMs);
  }
  const exponential = opts.baseDelayMs * Math.pow(opts.factor, attempt);
  const capped = Math.min(exponential, opts.maxDelayMs);
  return opts.jitter ? Math.random() * capped : capped;
}

// Promise-based sleep that rejects promptly if the signal aborts mid-wait.
function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(id);
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
