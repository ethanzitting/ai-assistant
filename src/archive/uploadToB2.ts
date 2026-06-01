import { authorizeB2, clearB2AuthCache } from "@/archive/authorizeB2.ts";
import { requireEnv } from "@/requireEnv.ts";
import { withRetry } from "@/retry/withRetry.ts";
import { HttpError } from "@/retry/httpError.ts";
import { warn } from "@/logger.ts";

interface B2UploadResult {
  fileId: string;
  fileName: string;
}

export function uploadToB2(
  fileBytes: ArrayBuffer,
  b2Path: string,
  mimeType: string,
  sha1Hex: string,
): Promise<B2UploadResult> {
  return withRetry(() => attemptUpload(fileBytes, b2Path, mimeType, sha1Hex), {
    shouldRetry: isRetryableError,
    // A B2 failure usually means the auth token or upload URL went stale — drop the cached
    // token so the next attempt re-authorizes and fetches a fresh upload URL.
    onRetry: (error, attempt, delayMs) => {
      clearB2AuthCache();
      warn("archive", "Retrying B2 upload", { attempt, delayMs: Math.round(delayMs), error: errorMessage(error) });
    },
  });
}

async function attemptUpload(
  fileBytes: ArrayBuffer,
  b2Path: string,
  mimeType: string,
  sha1Hex: string,
): Promise<B2UploadResult> {
  const auth = await authorizeB2();
  const bucketId = requireEnv("B2_BUCKET_ID");

  const uploadUrlResponse = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: "POST",
    headers: {
      Authorization: auth.authorizationToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ bucketId }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!uploadUrlResponse.ok) throw await b2Error(uploadUrlResponse, "get_upload_url");

  const { uploadUrl, authorizationToken } = await uploadUrlResponse.json();
  const encodedPath = b2Path.split("/").map(encodeURIComponent).join("/");

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: authorizationToken,
      "Content-Type": mimeType,
      "X-Bz-File-Name": encodedPath,
      "Content-Length": String(fileBytes.byteLength),
      "X-Bz-Content-Sha1": sha1Hex,
    },
    body: fileBytes,
    signal: AbortSignal.timeout(60_000),
  });
  if (!uploadResponse.ok) throw await b2Error(uploadResponse, "upload");

  const data = await uploadResponse.json();
  return { fileId: data.fileId, fileName: data.fileName };
}

// Retryable statuses become HttpError (triggers retry, and onRetry re-authorizes); the rest
// carry the response body as a detailed, non-retryable error.
// NOTE: 401 is intentionally retryable here — for a B2 *upload* it means the upload token
// expired, which the onRetry re-auth fixes. Do NOT "correct" this by removing 401; that would
// break token-expiry recovery. (The authorize call, by contrast, treats 401 as fatal.)
const RETRYABLE_STATUS = new Set([401, 408, 429, 500, 502, 503, 504]);

async function b2Error(response: Response, label: string): Promise<Error> {
  if (RETRYABLE_STATUS.has(response.status)) return new HttpError(response);
  const body = await response.text();
  return new Error(`B2 ${label} failed (${response.status}): ${body}`);
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof HttpError) return true;
  if (error instanceof TypeError) return true; // network failure
  return error instanceof DOMException && error.name === "TimeoutError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
