import { db } from "@/db.ts";

export interface StoreExtractedTextArgs {
  archivedFileId: string;
  ocrText: string | null;
  ocrModel: string | null;
  visionDescription: string | null;
  visionModel: string | null;
}

// The archived_files row is the source of truth for re-indexing: document_chunks holds the
// composed text, so recomposing from a chunk would fold the description back into the OCR on
// every run. Ingest and the backfill both write through here so the two can never drift.
export async function storeExtractedText(args: StoreExtractedTextArgs): Promise<void> {
  await db`
    UPDATE archived_files
    SET ocr_text           = ${args.ocrText},
        ocr_model          = ${args.ocrModel},
        vision_description = ${args.visionDescription},
        vision_model       = ${args.visionModel}
    WHERE id = ${args.archivedFileId}
  `;
}
