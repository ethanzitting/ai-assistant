import { db } from "@/db.ts";
import { findExistingEntity } from "@/knowledge/findExistingEntity.ts";
import type { FactInput } from "@/knowledge/rememberSchema.ts";
import type { KnowledgeWriteResult } from "@/knowledge/knowledgeWriteResult.ts";
import { safeEmbed } from "@/embeddings/safeEmbed.ts";
import { factEmbeddingText } from "@/embeddings/embeddingText.ts";
import { toVectorLiteral } from "@/embeddings/toVectorLiteral.ts";
import { EMBEDDING_MODEL_TAG } from "@/embeddings/embeddingModel.ts";
import { SEMANTIC_DEDUP_THRESHOLD } from "@/embeddings/searchConfig.ts";
import { trace } from "@/trace.ts";

export async function storeFact(
  input: FactInput,
  traceId: string,
): Promise<KnowledgeWriteResult> {
  const { entity_name: entityName, attribute, value } = input;

  const candidates = await findExistingEntity(entityName);
  if (candidates.length === 0) {
    return {
      content:
        `No entity found matching "${entityName}". Create the entity first.`,
      changed: false,
      reason: "entity_not_found",
      isError: true,
    };
  }
  if (candidates.length > 1) {
    const list = candidates.map((ent) =>
      `  - ${ent.name} (${ent.type}, id: ${ent.id})`
    );
    return {
      content: `Multiple entities match "${entityName}":\n${
        list.join("\n")
      }\nPlease specify which one.`,
      changed: false,
      reason: "ambiguous_entity",
      isError: true,
    };
  }

  const entityId = candidates[0].id;
  const name = candidates[0].name;

  const existing = await db`
    SELECT value FROM facts
    WHERE entity_id = ${entityId} AND attribute = ${attribute} AND valid_until IS NULL
    LIMIT 1
  `;

  if (existing.length > 0 && existing[0].value === value) {
    return {
      content:
        `Already stored: ${name}.${attribute} = "${value}". Stored and current — do not re-store.`,
      changed: false,
      reason: "fact_exists",
    };
  }

  const embedding = await safeEmbed(
    factEmbeddingText(name, attribute, value),
    "stored-document",
  );
  const embeddingLiteral = embedding ? toVectorLiteral(embedding) : null;
  const embeddingModel = embedding ? EMBEDDING_MODEL_TAG : null;

  if (existing.length > 0) {
    // deno-lint-ignore no-explicit-any
    await db.begin(async (tx: any) => {
      await tx`
        UPDATE facts SET valid_until = now()
        WHERE entity_id = ${entityId} AND attribute = ${attribute} AND valid_until IS NULL
      `;
      await tx`
        INSERT INTO facts (entity_id, attribute, value, embedding, embedding_model)
        VALUES (${entityId}, ${attribute}, ${value}, ${embeddingLiteral}::vector, ${embeddingModel})
      `;
    });
    await trace(traceId, "db.update", {
      table: "facts",
      entityId,
      attribute,
      op: "close_old",
      previousValue: existing[0].value,
    });
    await trace(traceId, "db.insert", {
      table: "facts",
      entityId,
      attribute,
      value,
    });
  } else {
    // New attribute. Guard against attribute drift: if a near-identical fact already exists
    // on this entity under a different attribute name (e.g. medication_droperidol vs
    // med_droperidol), skip rather than create a redundant attribute. Only runs when the
    // incoming fact embedded; otherwise falls through to a normal insert.
    if (embeddingLiteral) {
      const nearDuplicate = await db`
        SELECT attribute, value, (embedding <=> ${embeddingLiteral}::vector) AS distance
        FROM facts
        WHERE entity_id = ${entityId} AND valid_until IS NULL AND embedding IS NOT NULL
          AND embedding_model = ${EMBEDDING_MODEL_TAG}
          AND (embedding <=> ${embeddingLiteral}::vector) < ${SEMANTIC_DEDUP_THRESHOLD}
        ORDER BY embedding <=> ${embeddingLiteral}::vector
        LIMIT 1
      `;
      if (nearDuplicate.length > 0) {
        await trace(traceId, "fact.semantic_dedup", {
          entityId,
          attribute,
          matchedAttribute: nearDuplicate[0].attribute,
          distance: nearDuplicate[0].distance,
        });
        return {
          content: `Already captured: ${name}.${
            nearDuplicate[0].attribute
          } = "${
            nearDuplicate[0].value
          }". Your input is a near-duplicate of this, so it was not stored — do not re-store.`,
          changed: false,
          reason: "near_duplicate",
        };
      }
    }

    await db`
      INSERT INTO facts (entity_id, attribute, value, embedding, embedding_model)
      VALUES (${entityId}, ${attribute}, ${value}, ${embeddingLiteral}::vector, ${embeddingModel})
    `;
    await trace(traceId, "db.insert", {
      table: "facts",
      entityId,
      attribute,
      value,
    });
  }

  const verb = existing.length > 0 ? "Updated" : "Stored";
  return {
    content: `${verb} fact: ${name}.${attribute} = "${value}"`,
    changed: true,
    reason: existing.length > 0 ? "fact_updated" : "fact_stored",
  };
}
