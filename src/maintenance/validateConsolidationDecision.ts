import * as v from "valibot";

export type ConsolidatedFact = { attribute: string; value: string };
export type ConsolidationContent = {
  consolidatedFacts: ConsolidatedFact[];
  reasoning: string;
};

const nonemptyText = v.pipe(v.string(), v.trim(), v.minLength(1));
const decisionSchema = v.strictObject({
  consolidatedFacts: v.pipe(
    v.array(v.strictObject({
      attribute: v.pipe(
        nonemptyText,
        v.maxLength(100),
        v.regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/, "Must be snake_case"),
      ),
      value: v.pipe(nonemptyText, v.maxLength(10_000)),
    })),
    v.minLength(1, "At least one consolidated fact is required"),
    v.maxLength(50),
  ),
  reasoning: v.pipe(nonemptyText, v.maxLength(2_000)),
});

export function validateConsolidationDecision(
  input: unknown,
): ConsolidationContent {
  const result = v.safeParse(decisionSchema, input);
  if (!result.success) {
    const detail = result.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Invalid consolidation decision: ${detail}`);
  }

  const keys = result.output.consolidatedFacts.map((fact) =>
    `${fact.attribute}\u0000${fact.value}`
  );
  if (new Set(keys).size !== keys.length) {
    throw new Error("Invalid consolidation decision: duplicate facts");
  }
  return result.output;
}
