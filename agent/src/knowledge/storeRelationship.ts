import { db } from "@/database.ts";
import { findExistingEntity } from "@/knowledge/findExistingEntity.ts";
import type { ToolResult } from "@/tools/toolTypes.ts";

export async function storeRelationship(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const entityAName = input.entity_a_name as string;
  const entityBName = input.entity_b_name as string;
  const relationshipType = input.type as string;

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

  return { content: `Stored relationship: ${entityA[0].name} → ${relationshipType} → ${entityB[0].name}` };
}
