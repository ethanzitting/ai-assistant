import { db } from "@/db.ts";
import { chunkText } from "@/embeddings/chunkText.ts";
import { safeEmbed } from "@/embeddings/safeEmbed.ts";
import { toVectorLiteral } from "@/embeddings/toVectorLiteral.ts";
import { EMBEDDING_MODEL_TAG } from "@/embeddings/embeddingModel.ts";
import type { SourceType } from "@/archive/sourceTypes.ts";
import { error, info } from "@/logger.ts";

export interface EmbedArchivedFileArgs {
  archivedFileId: string;
  sourceType: SourceType;
  text: string;
  metadata?: Record<string, unknown>;
}

// Chunk a file's extracted text and store one row per chunk in document_chunks, linked to
// its archived_files row. The chunk row is ALWAYS inserted (content stored, so it's at least
// keyword-searchable right away); the embedding is best-effort. If an embed fails, the row
// lands with a null embedding rather than being dropped — `make reembed` heals null
// embeddings later. So a transient embedder outage can't silently lose a chunk, and partial
// coverage never becomes permanent. Runs sequentially so failures surface in the same trace.
export async function embedArchivedFile(args: EmbedArchivedFileArgs): Promise<void> {
  const { archivedFileId, sourceType, text, metadata = {} } = args;
  const chunks = chunkText(text);
  if (chunks.length === 0) return;

  let embedded = 0;
  for (let index = 0; index < chunks.length; index++) {
    const vector = await safeEmbed(chunks[index], "stored-document");
    try {
      await db`
        INSERT INTO document_chunks
          (archived_file_id, chunk_index, content, embedding, embedding_model, source_type, metadata)
        VALUES
          (${archivedFileId}, ${index}, ${chunks[index]}, ${vector ? toVectorLiteral(vector) : null}::vector,
           ${vector ? EMBEDDING_MODEL_TAG : null}, ${sourceType}, ${db.json(metadata as never)})
      `;
      if (vector) embedded++;
    } catch (err: unknown) {
      error("embeddings", "Failed to store archive chunk", {
        archivedFileId,
        chunkIndex: index,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  info("embeddings", "Stored archived file", {
    archivedFileId,
    sourceType,
    chunks: chunks.length,
    embedded,
  });
}
