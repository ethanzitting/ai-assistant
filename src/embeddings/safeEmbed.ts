import { embedText, type EmbedMode } from "@/embeddings/embedText.ts";
import { warn } from "@/logger.ts";

// Best-effort embedding for the write/query path: on failure, log and return null
// rather than throwing. Rows store a null vector (keyword search still covers them;
// backfill retries them); a failed query embedding degrades to keyword-only search.
export async function safeEmbed(text: string, mode: EmbedMode): Promise<number[] | null> {
  try {
    return await embedText(text, mode);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    warn("embeddings", "Embedding failed, continuing without vector", { mode, error: message });
    return null;
  }
}
