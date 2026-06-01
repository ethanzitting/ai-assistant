// Split long text into overlapping windows for embedding. Sizes are character-based
// (we have only a token estimator, not a tokenizer); a conservative 3.5 chars/token
// keeps every chunk well under gemini-embedding-001's hard 2048-token input limit.
const CHARS_PER_TOKEN = 3.5;
const MAX_INPUT_TOKENS = 1800; // margin under the model's 2048 hard limit
const MAX_CHARS = Math.floor(MAX_INPUT_TOKENS * CHARS_PER_TOKEN); // ~6300
const TARGET_CHARS = 4000; // ~1140 tokens — comfortably under MAX, good retrieval granularity
const OVERLAP_CHARS = 400;

export function chunkText(text: string): string[] {
  const clean = text.trim();
  if (clean.length === 0) return [];
  if (clean.length <= TARGET_CHARS) return [clean];

  const chunks: string[] = [];
  let start = 0;

  while (start < clean.length) {
    let end = Math.min(start + TARGET_CHARS, clean.length);

    // Prefer to end on a natural boundary in the back half of the window.
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const boundary = Math.max(
        window.lastIndexOf("\n\n"),
        window.lastIndexOf("\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf(" "),
      );
      if (boundary > TARGET_CHARS * 0.5) end = start + boundary + 1;
    }

    let chunk = clean.slice(start, end).trim();
    if (chunk.length > MAX_CHARS) chunk = chunk.slice(0, MAX_CHARS); // hard guard
    if (chunk.length > 0) chunks.push(chunk);

    if (end >= clean.length) break;
    const nextStart = end - OVERLAP_CHARS;
    start = nextStart > start ? nextStart : end; // always make progress
  }

  return chunks;
}
