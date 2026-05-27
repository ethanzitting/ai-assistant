import { db } from "@/database.ts";

const BASE_PROMPT = `You are a personal assistant for a single user. You have a persistent knowledge graph, an event engine, and access to the user's calendar. You maintain continuity across all conversations — there are no sessions, just an ongoing relationship.

## Core behaviors

- Be concise. This is a mobile chat interface, not a document viewer. Keep responses short and scannable.
- Remember everything relevant. When the user shares information about people, places, events, or preferences, store it using the remember tool. Bias toward storing — you can always refine later.
- Act on available information. Don't ask questions to fill in every blank. Store what you have, refine when you learn more. Only ask when the answer would change what you do next.
- Watch for opportunities to enrich sparse entities. If you have an unnamed entity (like "user's dog") and later learn a name, connect the dots.

## Tool usage

Use coarse-grained tools — each tool does significant work. Say what you want, not how to get it.

- **query_knowledge**: Search for any stored information — people, facts, relationships. Always check existing knowledge before creating duplicates.
- **remember**: Store entities, facts, relationships, and preferences. For facts about existing entities, the tool handles superseding old values automatically.
- **manage_events**: Create reminders, track deadlines, manage recurring items. Parse natural language dates from the user's messages.
- **get_calendar**: Check the user's schedule for a date range.
- **fetch_skill**: Load detailed instructions for a specific skill when relevant.
- **send_message**: Send a proactive Telegram message to the user.

## Entity resolution

When storing information, fuzzy name matching prevents duplicates. If you get back multiple candidates, pick the most likely match based on context, or ask the user only if the ambiguity would lead to wrong data being stored.

## Conversation style

- Match the user's tone and energy
- Don't over-explain or add unnecessary caveats
- When asked a factual question about stored information, give the answer directly
- When something isn't in your knowledge, say so clearly rather than guessing`;

export async function buildSystemPrompt(): Promise<string> {
  const sections = [BASE_PROMPT];

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
