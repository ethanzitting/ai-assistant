import { db } from "@/db.ts";

export interface EntityRecord {
  id: string;
  type: string;
  name: string;
  properties: unknown;
}

export async function searchEntities(
  searchQuery: string,
  entityType?: string,
): Promise<EntityRecord[]> {
  const searchPattern = `%${searchQuery}%`;

  if (entityType) {
    return db`
      SELECT id, type, name, properties
      FROM entities
      WHERE type = ${entityType} AND name ILIKE ${searchPattern}
      ORDER BY name LIMIT 20
    `;
  }

  return db`
    SELECT id, type, name, properties
    FROM entities
    WHERE name ILIKE ${searchPattern}
    ORDER BY name LIMIT 20
  `;
}
