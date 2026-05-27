import { db } from "@/db.ts";
import { SYSTEM_PROMPT } from "@/context/system-prompt.ts";

export async function buildSystemPrompt(): Promise<string> {
  const sections = [SYSTEM_PROMPT];

  const skills = await loadSkillSummaries();
  if (skills.length > 0) {
    sections.push(formatSkillList(skills));
  }

  const preferences = await loadPreferences();
  if (preferences.length > 0) {
    sections.push(formatPreferences(preferences));
  }

  return sections.join("\n\n");
}

async function loadSkillSummaries(): Promise<{ name: string; description: string }[]> {
  return await db`
    SELECT name, description FROM skills ORDER BY name
  ` as unknown as { name: string; description: string }[];
}

async function loadPreferences(): Promise<{ key: string; value: unknown }[]> {
  return await db`
    SELECT key, value FROM preferences ORDER BY key
  ` as unknown as { key: string; value: unknown }[];
}

function formatSkillList(
  skills: { name: string; description: string }[],
): string {
  const lines = skills.map(
    (skill) => `- **${skill.name}**: ${skill.description}`,
  );
  return `## Available Skills\n${lines.join("\n")}`;
}

function formatPreferences(
  preferences: { key: string; value: unknown }[],
): string {
  const lines = preferences.map(
    (pref) => `- ${pref.key}: ${JSON.stringify(pref.value)}`,
  );
  return `## User Preferences\n${lines.join("\n")}`;
}
