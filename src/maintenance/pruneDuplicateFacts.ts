import { db } from "@/db.ts";

type DuplicateFactRow = {
  id: string;
  entity_name: string;
  attribute: string;
  value_preview: string;
  rn: number;
};

export async function pruneDuplicateFacts(options: { apply: boolean }): Promise<number> {
  const rows = await db`
    WITH ranked AS (
      SELECT f.id, e.name AS entity_name, f.attribute, f.value,
        (row_number() OVER (PARTITION BY f.entity_id, f.value ORDER BY f.created_at, f.id))::int AS rn,
        count(*) OVER (PARTITION BY f.entity_id, f.value) AS group_size
      FROM facts f JOIN entities e ON e.id = f.entity_id
      WHERE f.valid_until IS NULL
    )
    SELECT id, entity_name, attribute, left(value, 70) AS value_preview, rn
    FROM ranked WHERE group_size > 1
    ORDER BY entity_name, value_preview, rn
  ` as unknown as DuplicateFactRow[];

  if (rows.length === 0) {
    console.log("\nDuplicate facts (same entity, identical value): none.");
    return 0;
  }

  console.log("\nDuplicate facts (same entity, identical value) — keep oldest, retire the rest:");
  for (const row of rows) {
    if (row.rn === 1) console.log(`  [${row.entity_name}] keep "${row.attribute}" = "${row.value_preview}"`);
    else console.log(`      retire "${row.attribute}"`);
  }

  const idsToRetire = rows.filter((row) => row.rn > 1).map((row) => row.id);
  if (options.apply && idsToRetire.length > 0) {
    await db`UPDATE facts SET valid_until = now() WHERE id::text = ANY(${idsToRetire})`;
  }
  return idsToRetire.length;
}
