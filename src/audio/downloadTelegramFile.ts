import { requireEnv } from "@/requireEnv.ts";
import { fetchWithRetry } from "@/retry/fetchWithRetry.ts";

export async function downloadTelegramFile(
  filePath: string,
  botToken: string,
): Promise<ArrayBuffer> {
  if (filePath.startsWith("/")) {
    const bytes = await Deno.readFile(filePath);
    return bytes.buffer as ArrayBuffer;
  }

  const apiBase = requireEnv("TELEGRAM_API_URL");

  const url = `${apiBase}/file/bot${botToken}/${filePath}`;

  const response = await fetchWithRetry(url, {}, { timeoutMs: 120_000 });

  if (!response.ok) {
    throw new Error(`Telegram file download failed (${response.status}): ${filePath}`);
  }

  return response.arrayBuffer();
}
