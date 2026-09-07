// The image formats supported by the configured vision model. Notably absent: tiff, bmp, and application/pdf,
// all of which classifyDocument routes to OCR — so the document path must check before describing
// rather than assume anything OCR handles can also be described.
const SUPPORTED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

export type SupportedMediaType = typeof SUPPORTED_MEDIA_TYPES[number];

export function isSupportedMediaType(mimeType: string): mimeType is SupportedMediaType {
  return (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(mimeType);
}
