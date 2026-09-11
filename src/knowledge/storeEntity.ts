import { db } from "@/db.ts";
import { findExistingEntity } from "@/knowledge/findExistingEntity.ts";
import type { EntityInput } from "@/knowledge/rememberSchema.ts";
import type { KnowledgeWriteResult } from "@/knowledge/knowledgeWriteResult.ts";
import { safeEmbed } from "@/embeddings/safeEmbed.ts";
import { entityEmbeddingText } from "@/embeddings/embeddingText.ts";
import { toVectorLiteral } from "@/embeddings/toVectorLiteral.ts";
import { EMBEDDING_MODEL_TAG } from "@/embeddings/embeddingModel.ts";
import { trace } from "@/trace.ts";

export async function storeEntity(
  input: EntityInput,
  traceId: string,
): Promise<KnowledgeWriteResult> {
  const { name, type: entityType, properties } = input;

  const existing = await findExistingEntity(name);
  if (existing.length > 1) {
    const candidates = existing.map((ent) =>
      `  - ${ent.name} (${ent.type}, id: ${ent.id})`
    );
    return {
      content: `Multiple possible matches:\n${
        candidates.join("\n")
      }\nPlease specify which entity you mean, or confirm this is a new entity.`,
      changed: false,
      reason: "ambiguous_entity",
      isError: true,
    };
  }

  if (existing.length === 1) {
    return mergeProperties(
      existing[0].id,
      existing[0].name,
      properties ?? {},
      traceId,
    );
  }

  const embedding = await safeEmbed(
    entityEmbeddingText(name, entityType, properties),
    "stored-document",
  );
  const embeddingLiteral = embedding ? toVectorLiteral(embedding) : null;
  const embeddingModel = embedding ? EMBEDDING_MODEL_TAG : null;

  const result = await db`
    INSERT INTO entities (type, name, properties, embedding, embedding_model)
    VALUES (${entityType}, ${name}, ${
    db.json((properties ?? {}) as never)
  }, ${embeddingLiteral}::vector, ${embeddingModel})
    RETURNING id
  `;
  await trace(traceId, "db.insert", {
    table: "entities",
    id: result[0].id,
    name,
    type: entityType,
  });
  return {
    content: `Created entity "${name}" (${entityType}, id: ${result[0].id}).`,
    changed: true,
    reason: "entity_created",
  };
}

async function mergeProperties(
  entityId: string,
  entityName: string,
  incoming: Record<string, unknown>,
  traceId: string,
): Promise<KnowledgeWriteResult> {
  if (Object.keys(incoming).length === 0) {
    return {
      content:
        `Entity "${entityName}" already exists (id: ${entityId}). Stored and current — do not re-store.`,
      changed: false,
      reason: "entity_exists",
    };
  }

  const rows = await db`SELECT properties FROM entities WHERE id = ${entityId}`;
  // Guard: only spread a genuine object. If stored properties are somehow not an object
  // (e.g. legacy corrupt data), start fresh rather than spreading a string into char-indexed
  // keys — the bug that previously snowballed properties into multi-MB blobs.
  const stored = rows[0].properties;
  const current =
    (stored && typeof stored === "object" && !Array.isArray(stored))
      ? stored as Record<string, unknown>
      : {};
  const merged = { ...current, ...incoming };

  await db`UPDATE entities SET properties = ${
    db.json(merged as never)
  } WHERE id = ${entityId}`;
  await trace(traceId, "db.update", {
    table: "entities",
    id: entityId,
    mergedKeys: Object.keys(incoming),
  });
  return {
    content:
      `Entity "${entityName}" already exists (id: ${entityId}). Merged new properties: ${
        Object.keys(incoming).join(", ")
      }. Stored and current — do not re-store.`,
    changed: true,
    reason: "properties_merged",
  };
}
