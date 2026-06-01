import { db } from "@/db.ts";
import { findExistingEntity } from "@/knowledge/findExistingEntity.ts";
import type { FactInput } from "@/knowledge/rememberSchema.ts";
import type { ToolResult } from "@/tools/toolTypes.ts";
import { safeEmbed } from "@/embeddings/safeEmbed.ts";
import { factEmbeddingText } from "@/embeddings/embeddingText.ts";
import { toVectorLiteral } from "@/embeddings/toVectorLiteral.ts";
import { EMBEDDING_MODEL_TAG } from "@/embeddings/embeddingModel.ts";
import { trace } from "@/trace.ts";

export async function storeFact(
  input: FactInput,
  traceId: string,
): Promise<ToolResult> {
  const { entity_name: entityName, attribute, value } = input;

  const candidates = await findExistingEntity(entityName);
  if (candidates.length === 0) {
    return { content: `No entity found matching "${entityName}". Create the entity first.`, isError: true };
  }
  if (candidates.length > 1) {
    const list = candidates.map((ent) => `  - ${ent.name} (${ent.type}, id: ${ent.id})`);
    return { content: `Multiple entities match "${entityName}":\n${list.join("\n")}\nPlease specify which one.` };
  }

  const entityId = candidates[0].id;
  const name = candidates[0].name;

  const existing = await db`
    SELECT value FROM facts
    WHERE entity_id = ${entityId} AND attribute = ${attribute} AND valid_until IS NULL
    LIMIT 1
  `;

  if (existing.length > 0 && existing[0].value === value) {
    return { content: `Already stored: ${name}.${attribute} = "${value}". Stored and current — do not re-store.` };
  }

  const embedding = await safeEmbed(factEmbeddingText(name, attribute, value), "stored-document");
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
      table: "facts", entityId, attribute, op: "close_old", previousValue: existing[0].value,
    });
    await trace(traceId, "db.insert", { table: "facts", entityId, attribute, value });
  } else {
    await db`
      INSERT INTO facts (entity_id, attribute, value, embedding, embedding_model)
      VALUES (${entityId}, ${attribute}, ${value}, ${embeddingLiteral}::vector, ${embeddingModel})
    `;
    await trace(traceId, "db.insert", { table: "facts", entityId, attribute, value });
  }

  const verb = existing.length > 0 ? "Updated" : "Stored";
  return { content: `${verb} fact: ${name}.${attribute} = "${value}"` };
}
