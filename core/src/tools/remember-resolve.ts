import { db } from "@/db.ts";

export interface EntityCandidate {
  id: string;
  name: string;
  type: string;
}

export async function findExistingEntity(
  name: string,
): Promise<EntityCandidate[]> {
  const exactMatches = await db`
    SELECT id, name, type FROM entities
    WHERE LOWER(name) = LOWER(${name})
  `;

  if (exactMatches.length > 0) {
    return exactMatches as unknown as EntityCandidate[];
  }

  const fuzzyMatches = await db`
    SELECT id, name, type FROM entities
    WHERE name ILIKE ${`%${name}%`}
    ORDER BY LENGTH(name)
    LIMIT 5
  `;

  return fuzzyMatches as unknown as EntityCandidate[];
}
