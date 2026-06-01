import { db } from "@/db.ts";
import { EMBEDDING_MODEL_TAG } from "@/embeddings/embeddingModel.ts";

// Distance below which two differently-worded facts on the same entity are likely the same
// information under a drifted attribute name. Looser than SEMANTIC_DEDUP_THRESHOLD (0.06):
// this only flags for human review and never deletes, so it casts a wider net.
const REVIEW_DISTANCE = 0.12;
const MAX_PAIRS = 60;

type NearDuplicatePair = {
  entity_name: string;
  attr_a: string;
  val_a: string;
  attr_b: string;
  val_b: string;
  distance: string;
};

export async function reportNearDuplicateFacts(): Promise<void> {
  const rows = await db`
    SELECT e.name AS entity_name,
      fa.attribute AS attr_a, left(fa.value, 45) AS val_a,
      fb.attribute AS attr_b, left(fb.value, 45) AS val_b,
      round((fa.embedding <=> fb.embedding)::numeric, 4) AS distance
    FROM facts fa
    JOIN facts fb ON fb.entity_id = fa.entity_id AND fb.id < fa.id
    JOIN entities e ON e.id = fa.entity_id
    WHERE fa.valid_until IS NULL AND fb.valid_until IS NULL
      AND fa.embedding IS NOT NULL AND fb.embedding IS NOT NULL
      AND fa.embedding_model = ${EMBEDDING_MODEL_TAG}
      AND fb.embedding_model = ${EMBEDDING_MODEL_TAG}
      AND fa.value <> fb.value
      AND (fa.embedding <=> fb.embedding) < ${REVIEW_DISTANCE}
    ORDER BY distance
    LIMIT ${MAX_PAIRS}
  ` as unknown as NearDuplicatePair[];

  console.log(`\nNear-duplicate facts with DIFFERING values (review by hand — NOT pruned), distance < ${REVIEW_DISTANCE}:`);
  if (rows.length === 0) {
    console.log("  none.");
    return;
  }
  for (const row of rows) {
    console.log(`  [${row.entity_name}] (${row.distance}) "${row.attr_a}"="${row.val_a}"  ~  "${row.attr_b}"="${row.val_b}"`);
  }
  if (rows.length === MAX_PAIRS) console.log(`  …only the closest ${MAX_PAIRS} shown; rerun after consolidating to see more.`);
}
