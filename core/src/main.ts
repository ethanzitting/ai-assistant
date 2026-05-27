import { db } from "@/db.ts";
import { EventQueue } from "@/queue.ts";
import { runEventLoop } from "@/loop/run.ts";

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
    console.log(`Tables: ${tables.map((row) => row.table_name).join(", ")}`);
  }
}

async function main(): Promise<void> {
  console.log("Starting core...");

  try {
    await healthCheck();
    console.log("Health check passed.");
  } catch (error) {
    console.error("Health check failed:", error);
    Deno.exit(1);
  }

  const queue = new EventQueue();

  queue.push({
    id: crypto.randomUUID(),
    type: "user_message",
    priority: "high",
    payload: { text: "Hello! What can you do?" },
    createdAt: new Date(),
  });

  await runEventLoop(queue);
}

main();
