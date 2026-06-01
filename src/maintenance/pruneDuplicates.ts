// pruneDuplicates — retire exact-duplicate facts and relationships from the live graph.
//
// "Duplicate" here is the zero-information-loss case only: facts on the same entity whose
// value is byte-identical (the attribute name may have drifted — medication_droperidol vs
// medications_droperidol), and relationships identical under undirected (a,b)/(b,a) + type.
// Duplicates are retired by setting valid_until = now(): reversible, audit-preserving, and
// enough to drop them from every live query. The surviving row keeps its embedding, so
// search is unaffected and no reembed is needed.
//
// Semantic near-duplicates with DIFFERING values — the bulk of the attribute-drift bloat —
// are deliberately NOT pruned: collapsing them loses information and needs human judgment.
// They are listed read-only at the end so a person can consolidate them by hand.
//
// Dry-run by default (reports, writes nothing). Pass --apply to commit.
//   make prune-duplicates          # dry run
//   make prune-duplicates-apply    # retire duplicates
import { db } from "@/db.ts";
import { pruneDuplicateFacts } from "@/maintenance/pruneDuplicateFacts.ts";
import { pruneDuplicateRelationships } from "@/maintenance/pruneDuplicateRelationships.ts";
import { reportNearDuplicateFacts } from "@/maintenance/reportNearDuplicateFacts.ts";

const apply = Deno.args.includes("--apply");
console.log(apply ? "── PRUNE (apply) ──" : "── PRUNE (dry run — pass --apply to write) ──");

const factsRetired = await pruneDuplicateFacts({ apply });
const relationshipsRetired = await pruneDuplicateRelationships({ apply });
await reportNearDuplicateFacts();

const verb = apply ? "Retired" : "Would retire";
console.log("\n── Summary ──");
console.log(`${verb} ${factsRetired} duplicate fact(s) and ${relationshipsRetired} duplicate relationship(s).`);
if (!apply && factsRetired + relationshipsRetired > 0) console.log("Re-run with --apply to commit.");

await db.end();
