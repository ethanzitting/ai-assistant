const OCR_URL = "https://api.mistral.ai/v1/ocr";
const OCR_MODEL = "mistral-ocr-latest";

export async function ocrImage(
  fileBytes: ArrayBuffer,
  mimeType: string,
): Promise<string | null> {
  const apiKey = Deno.env.get("MISTRAL_API_KEY");
  if (!apiKey) throw new Error("MISTRAL_API_KEY must be set");

  const base64 = arrayBufferToBase64(fileBytes);
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const response = await fetch(OCR_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OCR_MODEL,
      document: { type: "document_url", document_url: dataUrl },
    }),
    signal: AbortSignal.timeout(60_000),
  });

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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
