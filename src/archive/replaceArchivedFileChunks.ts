import { db } from "@/db.ts";
import { embedArchivedFile, type EmbedArchivedFileArgs } from "@/archive/embedArchivedFile.ts";

// Re-index a file whose extracted text has changed. Deleting first (rather than upserting on
// chunk_index) keeps embedArchivedFile's insert-only contract intact — it deliberately stores
// rows with null embeddings for `make reembed` to heal — and drops orphans when the new text
// chunks into fewer rows than the old. Empty text is a no-op so a failed description can never
// delete a file's only chunk and leave nothing in its place.
export async function replaceArchivedFileChunks(args: EmbedArchivedFileArgs): Promise<void> {
  if (args.text.trim().length === 0) return;

  await db`DELETE FROM document_chunks WHERE archived_file_id = ${args.archivedFileId}`;
  await embedArchivedFile(args);

  // embedArchivedFile logs insert failures and returns normally, so without this check a failed
  // insert would leave the file with no chunks at all and still look like it succeeded. Throwing
  // lets the caller record the failure and retry rather than silently dropping the file from
  // search.
  const [{ count }] = await db`
    SELECT count(*) FROM document_chunks WHERE archived_file_id = ${args.archivedFileId}
  ` as unknown as [{ count: string }];

  if (Number(count) === 0) {
    throw new Error(`Reindex stored no chunks for archived file ${args.archivedFileId}`);
  }
}
