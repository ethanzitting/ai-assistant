import { searchArchives, type ArchiveHit } from "@/archive/searchArchives.ts";
import { searchArchivesInputSchema } from "@/archive/searchArchivesSchema.ts";
import { SOURCE_TYPES } from "@/archive/sourceTypes.ts";
import { parseToolInput } from "@/tools/parseToolInput.ts";
import type { ToolDefinition, ToolResult } from "@/tools/toolTypes.ts";
import { trace } from "@/trace.ts";

const MAX_EXCERPT = 800;

export const searchArchivesTool: ToolDefinition = {
  schema: {
    name: "search_archives",
    description:
      "Search archived files — voice/audio transcripts and OCR'd photos and documents — by natural language. Check the prefetch block first — it previews relevant archives. You have a maximum of 2 research calls per turn (this tool + query_knowledge combined). Returns matching passages with their source file. Distinct from query_knowledge, which searches structured facts.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Natural-language description of the content you're looking for.",
        },
        source_type: {
          type: "string",
          enum: [...SOURCE_TYPES],
          description: "Optional filter by kind of archived file.",
        },
      },
      required: ["query"],
    },
  },
  handle: handleSearchArchives,
};

async function handleSearchArchives(
  input: Record<string, unknown>,
  traceId: string,
): Promise<ToolResult> {
  const parsed = parseToolInput(
    searchArchivesInputSchema,
    input,
    '{ query: "what to find", source_type?: "document"|"photo"|"voice_memo" }',
  );
  if (!parsed.success) return parsed.error;

  const { query, source_type: sourceType } = parsed.data;
  const hits = await searchArchives(query, sourceType);

  await trace(traceId, "archive.search", { query, sourceType, hits: hits.length });

  if (hits.length === 0) {
    return {
      content: `No archived files match "${query}". Do not retry the same search — nothing relevant is archived.`,
    };
  }

  return { content: hits.map(formatHit).join("\n\n---\n\n") };
}

function formatHit(hit: ArchiveHit): string {
  const label = hit.original_filename ?? hit.source_type;
  const excerpt = hit.content.length > MAX_EXCERPT
    ? `${hit.content.slice(0, MAX_EXCERPT)}…`
    : hit.content;
  return `**${label}** (${hit.source_type}, file ${hit.archived_file_id})\n${excerpt}`;
}
