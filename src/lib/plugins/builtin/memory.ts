/**
 * Memory Plugin
 *
 * Wraps the existing memory system as a plugin.
 * When enabled, the companion remembers information across conversations.
 */

import type { Plugin, PromptContext } from '../types'

export const memoryPlugin: Plugin = {
  manifest: {
    id: 'memory',
    name: 'Long-Term Memory',
    description: 'Remember information across conversations',
    version: '1.0.0',
  },

  getPromptAdditions: (context: PromptContext) => {
    if (!context.hasMemories) {
      return `## Memory System
You have the ability to remember important information about the user across conversations.
As you learn things about the user (preferences, projects, relationships, etc.), these will be stored and provided to you in future conversations.
You're just getting to know this user - no memories yet!`
    }

    return `## Memory System
You have long-term memory of past conversations with this user.
Relevant memories are provided in the "Long-Term Memory" section above.
- Reference memories naturally when relevant
- Use them to personalize your responses
- Don't force memories into every response
- If something seems outdated, ask to confirm`
  },

  // Memory services are handled by the memory store directly
  // This plugin mainly provides the prompt additions
  services: {
    // Placeholder - actual memory operations use useMemoryStore
  },
}

export default memoryPlugin
