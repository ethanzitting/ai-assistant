import { db } from "@/db.ts";
import { toVectorLiteral } from "@/embeddings/toVectorLiteral.ts";
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

export async function searchArchivesByVector(
  queryVector: number[],
  sourceType?: string,
): Promise<ArchiveHit[]> {
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
