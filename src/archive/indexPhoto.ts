import { archiveFile } from "@/archive/archiveFile.ts";
import { embedArchivedFile } from "@/archive/embedArchivedFile.ts";
import { storeExtractedText } from "@/archive/storeExtractedText.ts";
import { photoEmbeddingText } from "@/embeddings/embeddingText.ts";
import { ocrImage } from "@/ocr/ocrImage.ts";
import { OCR_MODEL } from "@/ocr/ocrModel.ts";
import { describeImage } from "@/vision/describeImage.ts";
import { VISION_MODEL } from "@/vision/visionModel.ts";
import { error } from "@/logger.ts";

const PHOTO_MIME_TYPE = "image/jpeg";

export interface IndexPhotoResult {
  archiveId: string | null;
  ocrText: string | null;
  visionDescription: string | null;
}

export async function indexPhoto(
  fileBytes: ArrayBuffer,
  telegramFileId: string,
): Promise<IndexPhotoResult> {
  const archiveId = await archivePhoto(fileBytes, telegramFileId);

  const [ocrResult, visionDescription] = await Promise.all([
    readText(fileBytes),
    describeImage(fileBytes, PHOTO_MIME_TYPE),
  ]);

  if (ocrResult.text) await archiveOcrText(ocrResult.text, telegramFileId, archiveId);

  if (archiveId) {
    await storeExtractedText({
      archivedFileId: archiveId,
      ocrText: ocrResult.text,
      ocrModel: ocrResult.model,
      visionDescription,
      visionModel: visionDescription ? VISION_MODEL : null,
    });

    await embedArchivedFile({
      archivedFileId: archiveId,
      sourceType: "photo",
      text: photoEmbeddingText({ visionDescription, ocrText: ocrResult.text }),
      metadata: { telegram_file_id: telegramFileId },
    });
  }

  return { archiveId, ocrText: ocrResult.text, visionDescription };
}

interface OcrResult {
  text: string | null;
  model: string | null;
}

// ocrImage throws on a non-2xx Mistral response. Left uncaught that aborts the whole ingest and the
// photo is dropped, so failure is folded into a null text — the vision description still carries the
// image into the index. The model is returned separately and only when the call completed: a null
// text with a model means the image genuinely had no text, whereas both null means OCR never ran and
// the row is still owed a retry.
async function readText(fileBytes: ArrayBuffer): Promise<OcrResult> {
  try {
    return { text: await ocrImage(fileBytes, PHOTO_MIME_TYPE), model: OCR_MODEL };
  } catch (err) {
    error("ocr", "Photo OCR failed, continuing", { error: String(err) });
    return { text: null, model: null };
  }
}

async function archivePhoto(
  fileBytes: ArrayBuffer,
  telegramFileId: string,
): Promise<string | null> {
  try {
    return await archiveFile({
      fileBytes,
      sourceType: "photo",
      label: telegramFileId,
      ext: "jpg",
      mimeType: PHOTO_MIME_TYPE,
      telegramFileId,
    });
  } catch (err) {
    error("archive", "Photo archival failed, continuing", { error: String(err) });
    return null;
  }
}

async function archiveOcrText(
  ocrText: string,
  telegramFileId: string,
  sourceArchiveId: string | null,
): Promise<void> {
  try {
    const textBytes = new TextEncoder().encode(ocrText);
    const metadata: Record<string, unknown> = {};
    if (sourceArchiveId) metadata.source_file_id = sourceArchiveId;

    await archiveFile({
      fileBytes: textBytes.buffer as ArrayBuffer,
      sourceType: "ocr_text",
      label: telegramFileId,
      ext: "txt",
      mimeType: "text/plain",
      metadata,
    });
  } catch (err) {
    error("archive", "OCR text archival failed, continuing", { error: String(err) });
  }
}
