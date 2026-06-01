import { db } from "@/db.ts";
import { tokenizeQuery } from "@/knowledge/tokenizeQuery.ts";

export interface EntityRecord {
  id: string;
  type: string;
  name: string;
  properties: unknown;
}

// Keyword leg of hybrid search. Tokenizes the query and matches any token against an
// entity name OR the attribute/value of its current facts — so a multi-word query like
// "Dana Whitfield medications" finds Dana (name match) even though no single entity is
// named that. Works with or without embeddings (recall booster + fallback).
export async function searchEntities(
  searchQuery: string,
  entityType?: string,
): Promise<EntityRecord[]> {
  const tokens = tokenizeQuery(searchQuery);
  if (tokens.length === 0) return [];
  const patterns = tokens.map((token) => `%${token}%`);

  if (entityType) {
    return db`
      SELECT DISTINCT e.id, e.type, e.name, e.properties
      FROM entities e
      LEFT JOIN facts f ON f.entity_id = e.id AND f.valid_until IS NULL
      WHERE e.type = ${entityType}
        AND (e.name ILIKE ANY(${patterns})
             OR f.attribute ILIKE ANY(${patterns})
             OR f.value ILIKE ANY(${patterns}))
      LIMIT 20
    ` as unknown as EntityRecord[];
  }

  return db`
    SELECT DISTINCT e.id, e.type, e.name, e.properties
    FROM entities e
    LEFT JOIN facts f ON f.entity_id = e.id AND f.valid_until IS NULL
    WHERE e.name ILIKE ANY(${patterns})
       OR f.attribute ILIKE ANY(${patterns})
       OR f.value ILIKE ANY(${patterns})
    LIMIT 20
  ` as unknown as EntityRecord[];
}
