import { db } from "@/db.ts";
import { findExistingEntity } from "@/knowledge/findExistingEntity.ts";
import type { ToolResult } from "@/tools/toolTypes.ts";

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
