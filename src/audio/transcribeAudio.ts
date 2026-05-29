const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen";

const PARAMS = new URLSearchParams({
  model: "nova-2",
  smart_format: "true",
  punctuate: "true",
  paragraphs: "true",
});

export async function transcribeAudio(
  audioBytes: ArrayBuffer,
  mimeType: string,
): Promise<string | null> {
  const apiKey = Deno.env.get("DEEPGRAM_API_KEY");
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY must be set");

  const response = await fetch(`${DEEPGRAM_URL}?${PARAMS}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": mimeType,
    },
    body: audioBytes,
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Deepgram transcription failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  const transcript: string | undefined =
    data.results?.channels?.[0]?.alternatives?.[0]?.transcript;

  if (!transcript || transcript.trim().length === 0) return null;

  return transcript;
}
