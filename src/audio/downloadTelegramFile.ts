const TELEGRAM_FILE_URL = "https://api.telegram.org/file/bot";

export async function downloadTelegramFile(
  filePath: string,
  botToken: string,
): Promise<ArrayBuffer> {
  const url = `${TELEGRAM_FILE_URL}${botToken}/${filePath}`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Telegram file download failed (${response.status}): ${filePath}`);
  }

  return response.arrayBuffer();
}
