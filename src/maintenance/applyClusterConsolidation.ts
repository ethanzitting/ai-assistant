import { db } from "@/db.ts";
import { safeEmbed } from "@/embeddings/safeEmbed.ts";
import { factEmbeddingText } from "@/embeddings/embeddingText.ts";
import { toVectorLiteral } from "@/embeddings/toVectorLiteral.ts";
import { EMBEDDING_MODEL_TAG } from "@/embeddings/embeddingModel.ts";
import type { FactCluster } from "@/maintenance/factClusters.ts";
import type { ConsolidationDecision } from "@/maintenance/proposeConsolidation.ts";

export async function applyClusterConsolidation(
  cluster: FactCluster,
  decision: ConsolidationDecision,
): Promise<void> {
  const toInsert: Array<{ attribute: string; value: string; embeddingLiteral: string | null; embeddingModel: string | null }> = [];
  for (const fact of decision.consolidatedFacts) {
    const vector = await safeEmbed(factEmbeddingText(cluster.entityName, fact.attribute, fact.value), "stored-document");
    toInsert.push({
      attribute: fact.attribute,
      value: fact.value,
      embeddingLiteral: vector ? toVectorLiteral(vector) : null,
      embeddingModel: vector ? EMBEDDING_MODEL_TAG : null,
    });
  }

  const originalIds = cluster.facts.map((fact) => fact.id);
  // deno-lint-ignore no-explicit-any
  await db.begin(async (tx: any) => {
    await tx`UPDATE facts SET valid_until = now() WHERE id::text = ANY(${originalIds})`;
    for (const fact of toInsert) {
      await tx`
        INSERT INTO facts (entity_id, attribute, value, embedding, embedding_model)
        VALUES (${cluster.entityId}, ${fact.attribute}, ${fact.value}, ${fact.embeddingLiteral}::vector, ${fact.embeddingModel})
      `;
    }
  });
}
