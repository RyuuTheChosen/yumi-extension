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
  EntityType,
  EntityLink,
  ConversationSummary,
} from './types'

export {
  MEMORY_HALF_LIFE,
  MEMORY_LIMITS,
  EXTRACTION_CONFIG,
  MEMORY_DB_CONFIG,
  EMBEDDING_CONFIG,
  CLUSTERING_CONFIG,
  ADAPTIVE_DECAY_CONFIG,
  SUMMARY_CONFIG,
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
  saveEntityLink,
  getEntityLink,
  getAllEntityLinks,
  getEntitiesForMemory,
  getEntitiesByType,
  removeMemoryFromEntities,
  clearAllEntityLinks,
  saveSummary,
  getSummary,
  getSummaryByConversationId,
  getAllSummaries,
  getRecentSummaries,
  getSummariesByUrl,
  deleteSummary,
  clearAllSummaries,
  getSummariesForMemories,
} from './db'

// Store
export * from './store'

// Extraction
export * from './extraction'

// Retrieval
export * from './retrieval'

// Feedback
export * from './feedback'

// Proactive
export * from './proactive'

// Embedding
export * from './embedding'

// Clustering
export * from './clustering'

// Learning (Adaptive Decay)
export * from './learning'

// Conversation (Summaries)
export * from './conversation'
