import { db } from "@/db.ts";
import { formatMoney } from "@/finance/formatMoney.ts";
import { userTimezone } from "@/userTimezone.ts";

interface AccountRow {
  name: string;
  type: string;
  subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  credit_limit: number | null;
  balance_as_of: Date | null;
}

export async function accountBalances(): Promise<string> {
  const rows = await db`
    SELECT name, type, subtype, current_balance, available_balance, credit_limit, balance_as_of
    FROM accounts ORDER BY type, name
  ` as unknown as AccountRow[];

  if (rows.length === 0) return "No linked accounts.";

  const lines = rows.map(describeAccount);
  const asOf = rows[0].balance_as_of;

  return [...lines, asOf ? `As of the last sync, ${inUserTimezone(asOf)}.` : ""]
    .filter(Boolean)
    .join("\n");
}

// Every other date in these results is in the user's own calendar, so a UTC stamp here would be
// the one figure they have to convert in their head.
function inUserTimezone(when: Date): string {
  return when.toLocaleString("en-US", {
    timeZone: userTimezone(),
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// A credit card's "current balance" is what is owed, not what is available to spend, so the two
// account kinds are described differently rather than being listed under one heading.
function describeAccount(row: AccountRow): string {
  const label = `${row.name} (${row.subtype ?? row.type})`;

  if (row.type === "credit") {
    const owed = formatMoney(row.current_balance ?? 0);
    const limit = row.credit_limit === null ? "" : ` of ${formatMoney(row.credit_limit)} limit`;
    const available = row.available_balance === null
      ? ""
      : `, ${formatMoney(row.available_balance)} available`;
    return `${label}: ${owed} owed${limit}${available}`;
  }

  const current = formatMoney(row.current_balance ?? 0);
  const available = row.available_balance === null
    ? ""
    : ` (${formatMoney(row.available_balance)} available)`;
  return `${label}: ${current}${available}`;
}
