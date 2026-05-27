import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { estimateTokenCount, truncateToTokenBudget } from "@/prompt/tokens.ts";

Deno.test("estimateTokenCount uses 4 chars per token", () => {
  assertEquals(estimateTokenCount(""), 0);
  assertEquals(estimateTokenCount("hi"), 1);
  assertEquals(estimateTokenCount("hello world!"), 3);
  assertEquals(estimateTokenCount("a".repeat(100)), 25);
});

Deno.test("truncateToTokenBudget keeps all messages when within budget", () => {
  const messages = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi there" },
  ];

  const result = truncateToTokenBudget(messages, 1000);
  assertEquals(result.length, 2);
  assertEquals(result[0].content, "hello");
});

Deno.test("truncateToTokenBudget drops oldest messages first", () => {
  const messages = [
    { role: "user", content: "a".repeat(100) },
    { role: "assistant", content: "b".repeat(100) },
    { role: "user", content: "c".repeat(100) },
  ];

  const result = truncateToTokenBudget(messages, 60);
  assertEquals(result.length, 2);
  assertEquals(result[0].content, "b".repeat(100));
  assertEquals(result[1].content, "c".repeat(100));
});

Deno.test("truncateToTokenBudget returns empty array when budget is zero", () => {
  const messages = [{ role: "user", content: "hello" }];
  const result = truncateToTokenBudget(messages, 0);
  assertEquals(result.length, 0);
});

Deno.test("truncateToTokenBudget handles single message exceeding budget", () => {
  const messages = [
    { role: "user", content: "a".repeat(1000) },
    { role: "assistant", content: "short" },
  ];

  const result = truncateToTokenBudget(messages, 5);
  assertEquals(result.length, 1);
  assertEquals(result[0].content, "short");
});

Deno.test("truncateToTokenBudget handles exact budget boundary", () => {
  const messages = [
    { role: "user", content: "a".repeat(40) },
    { role: "assistant", content: "b".repeat(40) },
  ];

  const result = truncateToTokenBudget(messages, 20);
  assertEquals(result.length, 2);
});
