import { uploadToB2 } from "@/archive/uploadToB2.ts";
import { db } from "@/db.ts";

interface ArchiveParams {
  fileBytes: ArrayBuffer;
  sourceType: string;
  label: string;
  ext: string;
  mimeType: string;
  originalFilename?: string;
  metadata?: Record<string, unknown>;
}

export async function archiveFile(params: ArchiveParams): Promise<string> {
  const { fileBytes, sourceType, label, ext, mimeType, originalFilename, metadata = {} } = params;

  const sha256Hex = await hashHex("SHA-256", fileBytes);
  const sha1Hex = await hashHex("SHA-1", fileBytes);

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const timestamp = Math.floor(now.getTime() / 1000);
  const b2Path = `archive/${year}/${month}/${sourceType}/${timestamp}_${label}.${ext}`;

  await uploadToB2(fileBytes, b2Path, mimeType, sha1Hex);

  const [row] = await db`
    INSERT INTO archived_files (source_type, b2_path, original_filename, mime_type, file_size_bytes, sha256, metadata)
    VALUES (${sourceType}, ${b2Path}, ${originalFilename ?? null}, ${mimeType}, ${fileBytes.byteLength}, ${sha256Hex}, ${JSON.stringify(metadata)})
    RETURNING id
  `;

  return row.id;
}

async function hashHex(algorithm: string, data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest(algorithm, data);
  const bytes = new Uint8Array(hashBuffer);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
