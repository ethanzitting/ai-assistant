import { db } from "@/db.ts";
import { findExistingEntity } from "@/knowledge/findExistingEntity.ts";
import type { ToolResult } from "@/tools/toolTypes.ts";
import { trace } from "@/trace.ts";

export async function storeRelationship(
  input: Record<string, unknown>,
  traceId: string,
): Promise<ToolResult> {
  const entityAName = input.entity_a_name as string;
  const entityBName = input.entity_b_name as string;
  const relationshipType = input.type as string;

  if (!entityAName || !entityBName || !relationshipType) {
    return { content: `Missing required fields. Got: entity_a_name=${entityAName}, entity_b_name=${entityBName}, type=${relationshipType}. Provide all three as strings.`, isError: true };
  }

  const entityA = await findExistingEntity(entityAName);
  const entityB = await findExistingEntity(entityBName);

  if (entityA.length !== 1 || entityB.length !== 1) {
    return { content: `Could not uniquely resolve both entities. Entity A matches: ${entityA.length}, Entity B matches: ${entityB.length}. Please be more specific.`, isError: true };
  }

  const existing = await db`
    SELECT id FROM relationships
    WHERE entity_a_id = ${entityA[0].id} AND entity_b_id = ${entityB[0].id} AND type = ${relationshipType}
    LIMIT 1
  `;

  if (existing.length > 0) {
    return { content: `Already known: ${entityA[0].name} → ${relationshipType} → ${entityB[0].name}. No changes made.` };
  }

  await db`
    INSERT INTO relationships (entity_a_id, entity_b_id, type)
    VALUES (${entityA[0].id}, ${entityB[0].id}, ${relationshipType})
  `;

  await trace(traceId, "db.insert", {
    table: "relationships",
    entityA: entityA[0].name,
    entityB: entityB[0].name,
    type: relationshipType,
  });
  return { content: `Stored relationship: ${entityA[0].name} → ${relationshipType} → ${entityB[0].name}` };
}
