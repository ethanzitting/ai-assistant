// Kept apart from validateFilters so it can be tested without a database: importing that module
// pulls in db.ts, which reads connection env at load time and fails on a bare test host.
export function unknownValues(requested: string[], known: string[]): string[] {
  return requested.filter((value) => !known.includes(value));
}
