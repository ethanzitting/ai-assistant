import postgres from "postgres";
import { requireEnv } from "@/requireEnv.ts";

export const db = postgres({
  host: requireEnv("DB_HOST"),
  port: parseInt(Deno.env.get("DB_PORT") || "5432"),
  user: requireEnv("DB_USER"),
  password: requireEnv("DB_PASSWORD"),
  database: requireEnv("DB_NAME"),
});
