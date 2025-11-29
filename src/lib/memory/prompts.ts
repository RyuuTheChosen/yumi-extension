/**
 * AI Prompts for Memory Extraction
 *
 * These prompts are used to extract memorable facts from conversations.
 */

/**
 * System prompt for memory extraction.
 * Instructs the AI to analyze conversation and extract facts about the user.
 */
export const MEMORY_EXTRACTION_SYSTEM_PROMPT = `You are a memory extraction system. Your job is to analyze conversations and extract facts worth remembering about the user.

RULES:
1. Only extract FACTS about the USER, not general knowledge or conversation topics
2. Be specific and concise - each memory should be a single clear fact
3. Only extract information the user explicitly stated or strongly implied
4. Never infer or assume facts not clearly present in the conversation
5. If unsure, don't extract - err on the side of caution

MEMORY TYPES:
- identity: Name, job title, location, age, company, role (e.g., "User's name is Alex", "User works as a frontend developer")
- preference: Likes, dislikes, preferred tools, methods, styles (e.g., "User prefers TypeScript over JavaScript", "User dislikes meetings")
- skill: Technologies they know, languages, things they're learning (e.g., "User knows React and Vue", "User is learning Rust")
- project: Things they're working on, side projects, work projects (e.g., "User is building a Chrome extension called Yumi")
- person: People they mention - colleagues, family, friends, pets (e.g., "User has a colleague named Sarah", "User has a cat named Luna")
- event: Recent happenings, things that occurred (e.g., "User had a job interview yesterday", "User just deployed a new feature")
- opinion: Views on topics, beliefs, stances (e.g., "User thinks React is better than Angular", "User believes in test-driven development")

SCORING:
- confidence (0.0-1.0): How explicitly was this stated?
  - 1.0 = User directly stated it ("I am a developer", "My name is Alex")
  - 0.7-0.9 = Strongly implied ("I've been coding in React for years" → User knows React well)
  - 0.5-0.7 = Reasonably inferred from context
  - Below 0.5 = Don't extract, too uncertain

- importance (0.0-1.0): How useful is this for future conversations?
  - 1.0 = Core identity (name, profession)
  - 0.7-0.9 = Significant facts (main skills, active projects)
  - 0.5-0.7 = Useful context (preferences, opinions)
  - 0.3-0.5 = Minor details (one-time events)

SENSITIVE CONTENT - NEVER EXTRACT:
- Passwords, API keys, tokens, secrets
- Credit card numbers, bank details
- Social security numbers, ID numbers
- Private health information
- Anything that looks like credentials

OUTPUT FORMAT:
Return a JSON array of extracted memories. If nothing worth remembering, return empty array [].

Example output:
[
  {
    "type": "identity",
    "content": "User is a frontend developer",
    "context": "Mentioned while discussing their work",
    "confidence": 0.95,
    "importance": 0.9
  },
  {
    "type": "skill",
    "content": "User is proficient in React and TypeScript",
    "context": "Has been using them professionally for 3 years",
    "confidence": 0.85,
    "importance": 0.8
  }
]`

/**
 * Build the user prompt with the conversation to analyze
 */
export function buildExtractionPrompt(
  messages: { role: string; content: string }[]
): string {
  // Format messages for analysis
  const formattedMessages = messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n')

  return `Analyze this conversation and extract facts worth remembering about the user.

CONVERSATION:
${formattedMessages}

Extract memorable facts as JSON array. Only include facts about the USER that would be useful in future conversations. If no facts worth remembering, return [].`
}

/**
 * Prompt for when we have existing memories (to avoid duplicates)
 */
export function buildExtractionPromptWithContext(
  messages: { role: string; content: string }[],
  existingMemories: { type: string; content: string }[]
): string {
  const formattedMessages = messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n')

  const formattedExisting =
    existingMemories.length > 0
      ? existingMemories.map((m) => `- [${m.type}] ${m.content}`).join('\n')
      : 'None yet'

  return `Analyze this conversation and extract NEW facts worth remembering about the user.

ALREADY KNOWN ABOUT USER:
${formattedExisting}

CONVERSATION:
${formattedMessages}

Extract NEW memorable facts as JSON array. Do NOT repeat facts we already know. Only include facts that add new information. If no new facts worth remembering, return [].`
}
