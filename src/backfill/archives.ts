// One-off backfill: chunk + embed the text of already-archived files into document_chunks.
// Pulls the original extracted text straight from the conversation rows (where the OCR
// text / transcript was stored, with the archive_id in metadata) — no B2 re-download and
// no re-OCR, so the searchable text exactly matches what Jarvis originally saw.
// Idempotent (skips files that already have chunks). Run inside the agent container:
//   make backfill-archives
import { db } from "@/db.ts";
import { embedArchivedFile } from "@/archive/embedArchivedFile.ts";
import type { SourceType } from "@/archive/sourceTypes.ts";

const rows = await db`
  SELECT content,
         metadata->>'archive_id' AS archive_id,
         metadata->>'source' AS source_type
  FROM conversations
  WHERE role = 'user' AND metadata->>'archive_id' IS NOT NULL
  ORDER BY created_at
` as unknown as Array<{ content: string; archive_id: string; source_type: string | null }>;

console.log(`Archived messages to consider: ${rows.length}`);

for (const row of rows) {
  const existing = await db`
    SELECT count(*)::int AS count FROM document_chunks WHERE archived_file_id = ${row.archive_id}
  ` as unknown as Array<{ count: number }>;

  if (existing[0].count > 0) {
    console.log(`  • skip (already chunked): ${row.archive_id}`);
    continue;
  }

  try {
    await embedArchivedFile({
      archivedFileId: row.archive_id,
      // Stored by typed producers; the DB column is plain text, so assert back to the union.
      sourceType: (row.source_type ?? "document") as SourceType,
      text: row.content,
    });
    console.log(`  ✓ ${row.archive_id}`);
  } catch (err: unknown) {
    console.error(`  ✗ ${row.archive_id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

await db.end();
console.log("Archive backfill complete.");
