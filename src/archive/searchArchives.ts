import { db } from "@/db.ts";
import { safeEmbed } from "@/embeddings/safeEmbed.ts";
import { tokenizeQuery } from "@/knowledge/tokenizeQuery.ts";
import { ARCHIVE_RESULT_LIMIT } from "@/embeddings/searchConfig.ts";
import { searchArchivesByVector, type ArchiveHit } from "@/archive/searchArchivesByVector.ts";

export type { ArchiveHit };

export async function searchArchives(query: string, sourceType?: string): Promise<ArchiveHit[]> {
  const queryVector = await safeEmbed(query, "search-query");

  if (queryVector) {
    return searchArchivesByVector(queryVector, sourceType);
  }

  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];
  const patterns = tokens.map((token) => `%${token}%`);

  const rows = sourceType
    ? await db`
        SELECT dc.archived_file_id, dc.content, dc.source_type,
               af.original_filename, af.b2_path, af.telegram_file_id, af.mime_type, 2.0 AS distance
        FROM document_chunks dc JOIN archived_files af ON af.id = dc.archived_file_id
        WHERE dc.source_type = ${sourceType} AND dc.content ILIKE ANY(${patterns})
        LIMIT ${ARCHIVE_RESULT_LIMIT}`
    : await db`
        SELECT dc.archived_file_id, dc.content, dc.source_type,
               af.original_filename, af.b2_path, af.telegram_file_id, af.mime_type, 2.0 AS distance
        FROM document_chunks dc JOIN archived_files af ON af.id = dc.archived_file_id
        WHERE dc.content ILIKE ANY(${patterns})
        LIMIT ${ARCHIVE_RESULT_LIMIT}`;
  return rows as unknown as ArchiveHit[];
}
