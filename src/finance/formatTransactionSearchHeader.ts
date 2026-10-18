export function formatTransactionSearchHeader(
  totalMatches: number,
  rowsReturned: number,
): string {
  const truncated = totalMatches > rowsReturned;
  const rowLabel = truncated ? "Most recent rows:" : "Rows:";
  return `TOTAL_MATCHES: ${totalMatches}\nROWS_RETURNED: ${rowsReturned}\nTRUNCATED: ${truncated}\n${rowLabel}`;
}
