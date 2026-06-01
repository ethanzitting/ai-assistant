// Thrown for retryable HTTP responses so the retry loop can inspect status / Retry-After.
export class HttpError extends Error {
  constructor(
    readonly response: Response,
    readonly retryAfterMs?: number,
  ) {
    super(`HTTP ${response.status} ${response.statusText}`);
    this.name = "HttpError";
  }

  get status(): number {
    return this.response.status;
  }
}
