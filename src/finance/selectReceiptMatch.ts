export interface ReceiptMatchCandidate {
  transactionId: string;
  merchantName: string | null;
  postedDate: Date;
  dateDistance: number | null;
}

export function selectReceiptMatch(
  candidates: ReceiptMatchCandidate[],
): ReceiptMatchCandidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const [first, second] = candidates;
  if (first.dateDistance === null || second.dateDistance === null) return null;
  return first.dateDistance < second.dateDistance ? first : null;
}
