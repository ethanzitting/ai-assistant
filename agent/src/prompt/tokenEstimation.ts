const CHARS_PER_TOKEN = 4;

export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function truncateToTokenBudget(
  messages: { role: string; content: string }[],
  tokenBudget: number,
): { role: string; content: string }[] {
  let totalTokens = 0;
  const kept: { role: string; content: string }[] = [];

  for (let index = messages.length - 1; index >= 0; index--) {
    const messageTokens = estimateTokenCount(messages[index].content);

    if (totalTokens + messageTokens > tokenBudget) break;

    totalTokens += messageTokens;
    kept.unshift(messages[index]);
  }

  return kept;
}
