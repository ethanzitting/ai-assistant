import { requireEnv } from "@/requireEnv.ts";
import { fetchWithRetry } from "@/retry/fetchWithRetry.ts";

// Raw getFile rather than a grammY Bot, so scripts can resolve a file without constructing a
// second bot alongside the live polling one. The local Bot API server re-downloads files it has
// evicted from its cache, so old file_ids still resolve to readable paths.
export async function getTelegramFilePath(
  telegramFileId: string,
  botToken: string,
): Promise<string> {
  const apiBase = requireEnv("TELEGRAM_API_URL");
  const url = `${apiBase}/bot${botToken}/getFile?file_id=${encodeURIComponent(telegramFileId)}`;

  const response = await fetchWithRetry(url, {}, { timeoutMs: 60_000 });
  const body = await response.json();

  if (!body.ok || !body.result?.file_path) {
    throw new Error(`getFile failed: ${body.description ?? "no file_path returned"}`);
  }

  return body.result.file_path as string;
}
