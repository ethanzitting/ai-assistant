import { requireEnv } from "@/requireEnv.ts";
import { fetchWithRetry } from "@/retry/fetchWithRetry.ts";
import { arrayBufferToBase64 } from "@/encoding/arrayBufferToBase64.ts";
import { OCR_MODEL } from "@/ocr/ocrModel.ts";

const OCR_URL = "https://api.mistral.ai/v1/ocr";

export async function ocrImage(
  fileBytes: ArrayBuffer,
  mimeType: string,
): Promise<string | null> {
  const apiKey = requireEnv("MISTRAL_API_KEY");

  const base64 = arrayBufferToBase64(fileBytes);
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const response = await fetchWithRetry(OCR_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OCR_MODEL,
      document: { type: "document_url", document_url: dataUrl },
    }),
  }, { timeoutMs: 60_000 });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Mistral OCR failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  const pages = data.pages as { markdown: string }[] | undefined;
  if (!pages || pages.length === 0) return null;

  const text = pages.map((p) => p.markdown).join("\n\n").trim();
  return text.length === 0 ? null : text;
}
