// reembed — bring every searchable row up to the current embedding model.
//
// Standing maintenance command (not a one-off migration). It targets rows that have no
// embedding OR a stale embedding_model, so one idempotent command serves three needs:
//   * Initial migration — every row is null → all get embedded.
//   * Outage recovery — rows written while the embedder was down landed null → healed.
//   * Provider/model change — bump EMBEDDING_MODEL, and every row whose stored tag no longer
//     matches is re-embedded (vectors from different models aren't comparable).
//
// Self-contained: re-embeds from data already in the tables (entity name/props, fact
// attribute+value, chunk content) — no conversations, no re-OCR. Re-runnable any time.
//
// Run inside the agent container:  make reembed
import { db } from "@/db.ts";
import { embedText } from "@/embeddings/embedText.ts";
import { toVectorLiteral } from "@/embeddings/toVectorLiteral.ts";
import { EMBEDDING_MODEL_TAG } from "@/embeddings/embeddingModel.ts";
import { entityEmbeddingText, factEmbeddingText } from "@/embeddings/embeddingText.ts";

// Pace requests to stay under the embedding API's free-tier rate limit, which 429s on
// bursts. The retry layer absorbs the occasional 429; this prevents sustained throttling
// during a bulk run. reembed is idempotent, so anything still throttled is fixed on re-run.
const PACING_MS = 300;
const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function reembedEntities(): Promise<void> {
  const rows = await db`
    SELECT id, name, type, properties FROM entities
    WHERE embedding IS NULL OR embedding_model IS DISTINCT FROM ${EMBEDDING_MODEL_TAG}
  ` as unknown as Array<{ id: string; name: string; type: string; properties: Record<string, unknown> | null }>;

  console.log(`Entities to (re)embed: ${rows.length}`);
  for (const row of rows) {
    try {
      await sleep(PACING_MS);
      const vector = await embedText(entityEmbeddingText(row.name, row.type, row.properties), "stored-document");
      await db`
        UPDATE entities SET embedding = ${toVectorLiteral(vector)}::vector, embedding_model = ${EMBEDDING_MODEL_TAG}
        WHERE id = ${row.id}
      `;
      console.log(`  ✓ entity: ${row.name}`);
    } catch (err: unknown) {
      console.error(`  ✗ entity ${row.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function reembedFacts(): Promise<void> {
  // Only current facts are searched, so only they carry embeddings. valid_until IS NULL keeps
  // historical facts (which are intentionally never embedded) out of the null-embedding sweep.
  const rows = await db`
    SELECT f.id, f.attribute, f.value, e.name AS entity_name
    FROM facts f JOIN entities e ON e.id = f.entity_id
    WHERE f.valid_until IS NULL
      AND (f.embedding IS NULL OR f.embedding_model IS DISTINCT FROM ${EMBEDDING_MODEL_TAG})
  ` as unknown as Array<{ id: string; attribute: string; value: string; entity_name: string }>;

  console.log(`Current facts to (re)embed: ${rows.length}`);
  for (const row of rows) {
    try {
      await sleep(PACING_MS);
      const vector = await embedText(factEmbeddingText(row.entity_name, row.attribute, row.value), "stored-document");
      await db`
        UPDATE facts SET embedding = ${toVectorLiteral(vector)}::vector, embedding_model = ${EMBEDDING_MODEL_TAG}
        WHERE id = ${row.id}
      `;
      console.log(`  ✓ fact: ${row.entity_name}.${row.attribute}`);
    } catch (err: unknown) {
      console.error(`  ✗ fact ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function reembedDocumentChunks(): Promise<void> {
  const rows = await db`
    SELECT id, content FROM document_chunks
    WHERE embedding IS NULL OR embedding_model IS DISTINCT FROM ${EMBEDDING_MODEL_TAG}
  ` as unknown as Array<{ id: string; content: string }>;

  console.log(`Document chunks to (re)embed: ${rows.length}`);
  for (const row of rows) {
    try {
      await sleep(PACING_MS);
      const vector = await embedText(row.content, "stored-document");
      await db`
        UPDATE document_chunks SET embedding = ${toVectorLiteral(vector)}::vector, embedding_model = ${EMBEDDING_MODEL_TAG}
        WHERE id = ${row.id}
      `;
      console.log(`  ✓ chunk: ${row.id}`);
    } catch (err: unknown) {
      console.error(`  ✗ chunk ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

await reembedEntities();
await reembedFacts();
await reembedDocumentChunks();
await db.end();
console.log("Reembed complete.");
