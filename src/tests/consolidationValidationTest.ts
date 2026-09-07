import assert from "node:assert/strict";
import { validateConsolidationDecision } from "@/maintenance/validateConsolidationDecision.ts";

Deno.test("consolidation validation trims and accepts a safe decision", () => {
  assert.deepEqual(
    validateConsolidationDecision({
      consolidatedFacts: [{ attribute: " medication ", value: " Trazodone " }],
      reasoning: " Combined duplicates. ",
    }),
    {
      consolidatedFacts: [{ attribute: "medication", value: "Trazodone" }],
      reasoning: "Combined duplicates.",
    },
  );
});

Deno.test("consolidation validation rejects an empty replacement", () => {
  assert.throws(
    () =>
      validateConsolidationDecision({
        consolidatedFacts: [],
        reasoning: "Nothing retained.",
      }),
    /At least one consolidated fact/,
  );
});

Deno.test("consolidation validation rejects invalid or duplicate facts", () => {
  assert.throws(() =>
    validateConsolidationDecision({
      consolidatedFacts: [{ attribute: "Not snake case", value: "value" }],
      reasoning: "Invalid attribute.",
    })
  );
  assert.throws(
    () =>
      validateConsolidationDecision({
        consolidatedFacts: [
          { attribute: "medication", value: "Trazodone" },
          { attribute: "medication", value: "Trazodone" },
        ],
        reasoning: "Duplicates remained.",
      }),
    /duplicate facts/,
  );
});
