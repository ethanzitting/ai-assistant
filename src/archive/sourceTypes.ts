// The kinds of archived file that produce searchable text. Single source of truth for
// the producers (media handlers), the document_chunks.source_type values, the search
// filter validation, and the tool schema the model sees — so they can't drift apart.
export const SOURCE_TYPES = [
  "voice_memo",
  "audio",
  "video",
  "video_note",
  "photo",
  "document",
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];
