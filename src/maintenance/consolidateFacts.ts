// consolidateFacts — collapse attribute-drift bloat in the knowledge graph with an LLM.
//
// The write-time semantic dedup only stops same-value renames; it can't merge facts whose
// VALUES differ slightly ("Trazodone every night for sleep." vs "Getting trazodone every
// night for sleep."), so those accumulate. This script clusters live facts per entity by
// embedding distance (connected components under --threshold, default the dedup threshold —
// i.e. facts so close the system would not have created them as separate today), sends each
// cluster to Claude to merge into the smallest information-preserving set, then retires the
// originals (valid_until = now(), reversible) and inserts the consolidated facts.
//
// Dry-run by default — it still calls the LLM so you can review every proposed merge before
// committing. Pass --apply to write.
//   docker compose exec agent deno run --allow-net --allow-env --allow-read \
//     src/maintenance/consolidateFacts.ts [--apply] [--entity "Dana Whitfield"] [--limit 5] [--threshold 0.06]
//   make consolidate-facts          # dry run, all entities
//   make consolidate-facts-apply    # commit, all entities
import { db } from "@/db.ts";
import { currentDateLabel } from "@/currentDate.ts";
import { SEMANTIC_DEDUP_THRESHOLD } from "@/embeddings/searchConfig.ts";
import { findFactClusters } from "@/maintenance/factClusters.ts";
import { proposeConsolidation, type ConsolidationDecision } from "@/maintenance/proposeConsolidation.ts";
import { applyClusterConsolidation } from "@/maintenance/applyClusterConsolidation.ts";

function readFlag(name: string): string | undefined {
  const index = Deno.args.indexOf(name);
  return index >= 0 ? Deno.args[index + 1] : undefined;
}
const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const apply = Deno.args.includes("--apply");
const full = Deno.args.includes("--full");
const show = (text: string): string => (full || text.length <= 90 ? text : `${text.slice(0, 90)}…`);
const entityName = readFlag("--entity");
const threshold = Number(readFlag("--threshold") ?? SEMANTIC_DEDUP_THRESHOLD);
const limit = Number(readFlag("--limit") ?? Infinity);

console.log(apply ? "── CONSOLIDATE (apply) ──" : "── CONSOLIDATE (dry run — pass --apply to write) ──");
console.log(`Scope: ${entityName ?? "all entities"} | edge threshold: ${threshold}${Number.isFinite(limit) ? ` | limit: ${limit}` : ""}`);

const today = currentDateLabel();
const note = readFlag("--note");
const clusters = await findFactClusters({ entityName, threshold });
const selected = clusters.slice(0, limit);
console.log(`Found ${clusters.length} near-duplicate cluster(s); processing ${selected.length}. (today: ${today})`);

let plannedRetired = 0;
let plannedInserted = 0;
let inputTokens = 0;
let outputTokens = 0;

for (const [index, cluster] of selected.entries()) {
  console.log(`\n[${index + 1}/${selected.length}] ${cluster.entityName} — ${cluster.facts.length} facts:`);
  for (const fact of cluster.facts) console.log(`    - ${fact.attribute}: ${show(fact.value)}`);

  let decision: ConsolidationDecision;
  try {
    decision = await proposeConsolidation(cluster, { today, note });
  } catch (err: unknown) {
    console.error(`    ! skipped (LLM error): ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  inputTokens += decision.tokenUsage.inputTokens;
  outputTokens += decision.tokenUsage.outputTokens;
  plannedRetired += cluster.facts.length;
  plannedInserted += decision.consolidatedFacts.length;

  console.log(`  → consolidate ${cluster.facts.length} → ${decision.consolidatedFacts.length}:`);
  for (const fact of decision.consolidatedFacts) console.log(`    + ${fact.attribute}: ${show(fact.value)}`);
  console.log(`    (${decision.reasoning})`);

  if (apply) await applyClusterConsolidation(cluster, decision);
  await sleep(300);
}

console.log("\n── Summary ──");
console.log(`${apply ? "Retired" : "Would retire"} ${plannedRetired} fact(s); ${apply ? "inserted" : "would insert"} ${plannedInserted} consolidated fact(s).`);
console.log(`Net change: ${plannedInserted - plannedRetired} live facts across ${selected.length} cluster(s).`);
console.log(`Tokens: ${inputTokens} in / ${outputTokens} out.`);
if (!apply && plannedRetired > 0) console.log("Re-run with --apply to commit.");

await db.end();
