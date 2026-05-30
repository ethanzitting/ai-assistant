export async function downloadTelegramFile(
  filePath: string,
  botToken: string,
): Promise<ArrayBuffer> {
  if (filePath.startsWith("/")) {
    const bytes = await Deno.readFile(filePath);
    return bytes.buffer as ArrayBuffer;
  }

  const apiBase = Deno.env.get("TELEGRAM_API_URL");
  if (!apiBase) throw new Error("TELEGRAM_API_URL is not set");

  const url = `${apiBase}/file/bot${botToken}/${filePath}`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    throw new Error(`Telegram file download failed (${response.status}): ${filePath}`);
  }

  return response.arrayBuffer();
}
