import { db } from "@/database.ts";
import { findExistingEntity } from "@/knowledge/findExistingEntity.ts";
import type { ToolResult } from "@/tools/toolTypes.ts";

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
