import { db } from "./db.ts";

async function healthCheck(): Promise<void> {
  const result =
    await db`SELECT now() AS time, current_database() AS database`;
  console.log(
    `Connected to database '${result[0].database}' at ${result[0].time}`,
  );

  const tables = await db`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;

  if (tables.length === 0) {
    console.warn("No tables found — run 'make migrate' to apply migrations.");
  } else {
    console.log(`Tables: ${tables.map((t) => t.table_name).join(", ")}`);
  }
}

async function main(): Promise<void> {
  console.log("Starting core...");

  try {
    await healthCheck();
    console.log("Health check passed. Core is running.");
  } catch (error) {
    console.error("Health check failed:", error);
    Deno.exit(1);
  }

  // Keep the process alive — the event loop will go here in Phase 2
  await new Promise(() => {});
}

main();
