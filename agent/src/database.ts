import postgres from "postgres";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const db = postgres({
  host: requiredEnv("DB_HOST"),
  port: parseInt(Deno.env.get("DB_PORT") || "5432"),
  user: requiredEnv("DB_USER"),
  password: requiredEnv("DB_PASSWORD"),
  database: requiredEnv("DB_NAME"),
});
