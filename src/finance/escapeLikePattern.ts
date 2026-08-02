// % and _ are wildcards in LIKE, and category rules come from free text the user spoke aloud. An
// unescaped % matches every row — a rule containing one would silently recategorize the entire
// table. Backslash goes first so it cannot double-escape the characters added after it.
export function escapeLikePattern(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
