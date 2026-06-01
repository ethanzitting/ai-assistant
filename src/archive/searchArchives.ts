import { db } from "@/db.ts";
import { safeEmbed } from "@/embeddings/safeEmbed.ts";
import { toVectorLiteral } from "@/embeddings/toVectorLiteral.ts";
import { tokenizeQuery } from "@/knowledge/tokenizeQuery.ts";
import { EMBEDDING_MODEL_TAG } from "@/embeddings/embeddingModel.ts";
import { ARCHIVE_RESULT_LIMIT, DISTANCE_THRESHOLD } from "@/embeddings/searchConfig.ts";

export interface ArchiveHit {
  archived_file_id: string;
  content: string;
  source_type: string;
  original_filename: string | null;
  b2_path: string;
  distance: number;
}

// Hybrid search over archived-file chunks: semantic when the query embeds, keyword
// fallback otherwise. Returns ranked passages with their source file for attribution.
export async function searchArchives(query: string, sourceType?: string): Promise<ArchiveHit[]> {
  const queryVector = await safeEmbed(query, "search-query");

  if (queryVector) {
    const queryVectorLiteral = toVectorLiteral(queryVector);
    const rows = sourceType
      ? await db`
          SELECT dc.archived_file_id, dc.content, dc.source_type,
                 af.original_filename, af.b2_path,
                 (dc.embedding <=> ${queryVectorLiteral}::vector) AS distance
          FROM document_chunks dc JOIN archived_files af ON af.id = dc.archived_file_id
          WHERE dc.embedding IS NOT NULL AND dc.embedding_model = ${EMBEDDING_MODEL_TAG}
            AND dc.source_type = ${sourceType}
            AND (dc.embedding <=> ${queryVectorLiteral}::vector) < ${DISTANCE_THRESHOLD}
          ORDER BY distance LIMIT ${ARCHIVE_RESULT_LIMIT}`
      : await db`
          SELECT dc.archived_file_id, dc.content, dc.source_type,
                 af.original_filename, af.b2_path,
                 (dc.embedding <=> ${queryVectorLiteral}::vector) AS distance
          FROM document_chunks dc JOIN archived_files af ON af.id = dc.archived_file_id
          WHERE dc.embedding IS NOT NULL AND dc.embedding_model = ${EMBEDDING_MODEL_TAG}
            AND (dc.embedding <=> ${queryVectorLiteral}::vector) < ${DISTANCE_THRESHOLD}
          ORDER BY distance LIMIT ${ARCHIVE_RESULT_LIMIT}`;
    return rows as unknown as ArchiveHit[];
  }

  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];
  const patterns = tokens.map((token) => `%${token}%`);

  // Keyword fallback: reached only when query embedding failed, so there's no real cosine
  // distance to report. Each hit is stamped 2.0 — the maximum possible cosine distance — so
  // it satisfies ArchiveHit.distance and these lowest-confidence matches sort behind any
  // real vector hits if results are ever merged.
  const rows = sourceType
    ? await db`
        SELECT dc.archived_file_id, dc.content, dc.source_type,
               af.original_filename, af.b2_path, 2.0 AS distance
        FROM document_chunks dc JOIN archived_files af ON af.id = dc.archived_file_id
        WHERE dc.source_type = ${sourceType} AND dc.content ILIKE ANY(${patterns})
        LIMIT ${ARCHIVE_RESULT_LIMIT}`
    : await db`
        SELECT dc.archived_file_id, dc.content, dc.source_type,
               af.original_filename, af.b2_path, 2.0 AS distance
        FROM document_chunks dc JOIN archived_files af ON af.id = dc.archived_file_id
        WHERE dc.content ILIKE ANY(${patterns})
        LIMIT ${ARCHIVE_RESULT_LIMIT}`;
  return rows as unknown as ArchiveHit[];
}
