/**
 * Yumi Memory System
 *
 * Enables Yumi to remember facts about the user across conversations.
 *
 * Usage:
 * ```typescript
 * import { useMemoryStore, extractMemoriesFromConversation, getMemoriesForPrompt } from '@/lib/memory'
 *
 * // Load memories on startup
 * await useMemoryStore.getState().loadMemories()
 *
 * // Get memories for AI prompt
 * const { memories, context } = getMemoriesForPrompt(
 *   useMemoryStore.getState().memories,
 *   { currentMessage: userMessage }
 * )
 *
 * // Extract memories from conversation (after conversation ends)
 * const result = await extractMemoriesFromConversation(messages, existingMemories, conversationId)
 * if (result.success && result.memories.length > 0) {
 *   await useMemoryStore.getState().addMemories(result.memories)
 * }
 * ```
 */

// Types
export type {
  Memory,
  MemoryType,
  MemoryState,
  ExtractedMemory,
  ExtractionResult,
  RetrievalOptions,
  RetrievalContext,
} from './types'

export {
  MEMORY_HALF_LIFE,
  MEMORY_LIMITS,
  EXTRACTION_CONFIG,
  MEMORY_DB_CONFIG,
} from './types'

// Database
export {
  initMemoryDB,
  getAllMemories,
  getMemory,
  getMemoriesByType,
  saveMemory,
  saveMemories,
  deleteMemory,
  deleteMemoriesByType,
  clearAllMemories,
  markMemoryAccessed,
  findSimilarMemory,
  getMemoryCount,
  getRecentMemories,
} from './db'

// Store
export * from './store'

// Extraction
export * from './extraction'

// Retrieval
export * from './retrieval'

// Proactive
export * from './proactive'
