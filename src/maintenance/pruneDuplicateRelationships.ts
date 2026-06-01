import { db } from "@/db.ts";

type DuplicateRelationshipRow = {
  id: string;
  type: string;
  a_name: string;
  b_name: string;
  rn: number;
};

export async function pruneDuplicateRelationships(options: { apply: boolean }): Promise<number> {
  const rows = await db`
    WITH ranked AS (
      SELECT r.id, r.type, ea.name AS a_name, eb.name AS b_name,
        (row_number() OVER (grp ORDER BY r.created_at, r.id))::int AS rn,
        count(*) OVER grp AS group_size
      FROM relationships r
      JOIN entities ea ON ea.id = r.entity_a_id
      JOIN entities eb ON eb.id = r.entity_b_id
      WHERE r.valid_until IS NULL
      WINDOW grp AS (PARTITION BY
        least(r.entity_a_id::text, r.entity_b_id::text),
        greatest(r.entity_a_id::text, r.entity_b_id::text), r.type)
    )
    SELECT id, type, a_name, b_name, rn
    FROM ranked WHERE group_size > 1
    ORDER BY a_name, type, rn
  ` as unknown as DuplicateRelationshipRow[];

  if (rows.length === 0) {
    console.log("\nDuplicate relationships (undirected, same type): none.");
    return 0;
  }

  console.log("\nDuplicate relationships (undirected, same type) — keep oldest, retire the rest:");
  for (const row of rows) {
    const label = `${row.a_name} → ${row.type} → ${row.b_name}`;
    console.log(row.rn === 1 ? `  keep ${label}` : `      retire duplicate ${label}`);
  }

  const idsToRetire = rows.filter((row) => row.rn > 1).map((row) => row.id);
  if (options.apply && idsToRetire.length > 0) {
    await db`UPDATE relationships SET valid_until = now() WHERE id::text = ANY(${idsToRetire})`;
  }
  return idsToRetire.length;
}
