import { db } from "@/db.ts";
import { findExistingEntity } from "@/knowledge/resolve.ts";
import type { ToolResult } from "@/tools/types.ts";

export async function storeEntity(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const name = input.name as string;
  const entityType = input.type as string;
  const properties = input.properties ?? {};

  const existing = await findExistingEntity(name);
  if (existing.length === 1) {
    return { content: `Entity "${existing[0].name}" already exists (id: ${existing[0].id}).` };
  }
  if (existing.length > 1) {
    const candidates = existing.map((ent) => `  - ${ent.name} (${ent.type}, id: ${ent.id})`);
    return { content: `Multiple possible matches:\n${candidates.join("\n")}\nPlease specify which entity you mean, or confirm this is a new entity.` };
  }

  const result = await db`
    INSERT INTO entities (type, name, properties)
    VALUES (${entityType}, ${name}, ${JSON.stringify(properties)})
    RETURNING id
  `;
  return { content: `Created entity "${name}" (${entityType}, id: ${result[0].id}).` };
}

export async function storeFact(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const entityName = input.entity_name as string;
  const attribute = input.attribute as string;
  const value = input.value as string;

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
    return { content: `Already known: ${name}.${attribute} = "${value}". No changes made.` };
  }

  if (existing.length > 0) {
    await db`
      UPDATE facts SET valid_until = now()
      WHERE entity_id = ${entityId} AND attribute = ${attribute} AND valid_until IS NULL
    `;
  }

  await db`
    INSERT INTO facts (entity_id, attribute, value)
    VALUES (${entityId}, ${attribute}, ${value})
  `;

  const verb = existing.length > 0 ? "Updated" : "Stored";
  return { content: `${verb} fact: ${name}.${attribute} = "${value}"` };
}

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

export async function storePreference(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const key = input.key as string;
  const value = input.value;

  await db`
    INSERT INTO preferences (key, value, source)
    VALUES (${key}, ${JSON.stringify(value)}, 'explicit')
    ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(value)}, updated_at = now()
  `;

  return { content: `Stored preference: ${key} = ${JSON.stringify(value)}` };
}
