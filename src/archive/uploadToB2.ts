import { authorizeB2, clearB2AuthCache } from "@/archive/authorizeB2.ts";

interface B2UploadResult {
  fileId: string;
  fileName: string;
}

export async function uploadToB2(
  fileBytes: ArrayBuffer,
  b2Path: string,
  mimeType: string,
  sha1Hex: string,
): Promise<B2UploadResult> {
  const result = await attemptUpload(fileBytes, b2Path, mimeType, sha1Hex);
  return result;
}

async function attemptUpload(
  fileBytes: ArrayBuffer,
  b2Path: string,
  mimeType: string,
  sha1Hex: string,
  isRetry = false,
): Promise<B2UploadResult> {
  const auth = await authorizeB2();
  const bucketId = Deno.env.get("B2_BUCKET_ID");
  if (!bucketId) throw new Error("B2_BUCKET_ID must be set");

  const uploadUrlResponse = await fetch(
    `${auth.apiUrl}/b2api/v2/b2_get_upload_url`,
    {
      method: "POST",
      headers: {
        Authorization: auth.authorizationToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bucketId }),
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!uploadUrlResponse.ok) {
    if (!isRetry && isRetryable(uploadUrlResponse.status)) {
      clearB2AuthCache();
      return attemptUpload(fileBytes, b2Path, mimeType, sha1Hex, true);
    }
    const body = await uploadUrlResponse.text();
    throw new Error(`B2 get_upload_url failed (${uploadUrlResponse.status}): ${body}`);
  }

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

  if (!uploadResponse.ok) {
    if (!isRetry && isRetryable(uploadResponse.status)) {
      clearB2AuthCache();
      return attemptUpload(fileBytes, b2Path, mimeType, sha1Hex, true);
    }
    const body = await uploadResponse.text();
    throw new Error(`B2 upload failed (${uploadResponse.status}): ${body}`);
  }

  const data = await uploadResponse.json();
  return { fileId: data.fileId, fileName: data.fileName };
}

function isRetryable(status: number): boolean {
  return status === 401 || status === 500 || status === 503;
}
