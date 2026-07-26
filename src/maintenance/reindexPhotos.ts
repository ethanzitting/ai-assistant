// reindexPhotos — bring every archived photo up to a complete search index.
//
// Mistral OCR renders a plotted chart's data area as an ![img-0.jpeg] placeholder, so photos
// archived before the vision pass existed are indexed on their title alone — one real chart landed
// as 122 characters. This describes them and rebuilds document_chunks from description + OCR.
//
// Repeatable rather than one-shot: it heals a stale vision model, an OCR that never completed, and a
// photo left chunkless by an interrupted run. Each unit of work is gated on its own stamp, so a
// re-run costs nothing when everything is current, and only the missing piece is recomputed when
// it isn't.
//
// Requires migration 015 to have run first — it lifts the existing OCR text onto
// archived_files.ocr_text, which is where this reads it from. Reading OCR back out of a chunk
// would compound description into it on every pass.
//
// Run inside the agent container:  make reindex-photos
import { db } from "@/db.ts";
import { describeImage } from "@/vision/describeImage.ts";
import { ocrImage } from "@/ocr/ocrImage.ts";
import { OCR_MODEL } from "@/ocr/ocrModel.ts";
import { VISION_MODEL } from "@/vision/visionModel.ts";
import { storeExtractedText } from "@/archive/storeExtractedText.ts";
import { replaceArchivedFileChunks } from "@/archive/replaceArchivedFileChunks.ts";
import { photoEmbeddingText } from "@/embeddings/embeddingText.ts";
import { getTelegramFilePath } from "@/telegram/getTelegramFilePath.ts";
import { downloadTelegramFile } from "@/audio/downloadTelegramFile.ts";
import { requireEnv } from "@/requireEnv.ts";

const PACING_MS = 300;
const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

interface PhotoRow {
  id: string;
  telegram_file_id: string;
  ocr_text: string | null;
  ocr_model: string | null;
  vision_description: string | null;
  vision_model: string | null;
}

const botToken = requireEnv("TELEGRAM_BOT_TOKEN");

// Four kinds of gap, all healed by the same pass because they all need the image bytes: never
// described, described by a superseded model, OCR that never completed, and — the one that matters
// most — a photo left with no chunks at all by an interrupted earlier run. Without that last clause
// a crash between the chunk delete and insert would drop a photo from search permanently.
const rows = await db`
  SELECT id, telegram_file_id, ocr_text, ocr_model, vision_description, vision_model
  FROM archived_files af
  WHERE source_type = 'photo'
    AND telegram_file_id IS NOT NULL
    AND (vision_description IS NULL
         OR vision_model IS DISTINCT FROM ${VISION_MODEL}
         OR ocr_model IS NULL
         OR NOT EXISTS (SELECT 1 FROM document_chunks dc WHERE dc.archived_file_id = af.id))
  ORDER BY created_at
` as unknown as PhotoRow[];

console.log(`Photos to reindex: ${rows.length}`);

let reindexed = 0;
for (const row of rows) {
  try {
    await sleep(PACING_MS);

    const filePath = await getTelegramFilePath(row.telegram_file_id, botToken);
    const imageBytes = await downloadTelegramFile(filePath, botToken);

    const visionDescription = isDescriptionFresh(row)
      ? row.vision_description
      : await describeImage(imageBytes, "image/jpeg");

    const ocr = row.ocr_model
      ? { text: row.ocr_text, model: row.ocr_model }
      : await retryOcr(imageBytes);

    if (!visionDescription && !ocr.text) {
      console.error(`  ✗ photo ${row.id}: nothing readable from vision or OCR`);
      continue;
    }

    // Chunks first: a failure here leaves the stamps untouched, so the row still matches the query
    // above and is retried. Stamping first would mark it done and strand it out of the index.
    await replaceArchivedFileChunks({
      archivedFileId: row.id,
      sourceType: "photo",
      text: photoEmbeddingText({ visionDescription, ocrText: ocr.text }),
      metadata: { telegram_file_id: row.telegram_file_id },
    });

    await storeExtractedText({
      archivedFileId: row.id,
      ocrText: ocr.text,
      ocrModel: ocr.model,
      visionDescription,
      visionModel: visionDescription ? VISION_MODEL : null,
    });

    reindexed++;
    console.log(`  ✓ photo ${row.id}: ${(visionDescription ?? ocr.text ?? "").slice(0, 70)}…`);
  } catch (err: unknown) {
    console.error(`  ✗ photo ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function isDescriptionFresh(row: PhotoRow): boolean {
  return row.vision_description !== null && row.vision_model === VISION_MODEL;
}

async function retryOcr(imageBytes: ArrayBuffer): Promise<{ text: string | null; model: string | null }> {
  try {
    return { text: await ocrImage(imageBytes, "image/jpeg"), model: OCR_MODEL };
  } catch (err: unknown) {
    console.error(`    OCR retry failed: ${err instanceof Error ? err.message : String(err)}`);
    return { text: null, model: null };
  }
}

await db.end();
console.log(`Reindexed ${reindexed} of ${rows.length} photos.`);
