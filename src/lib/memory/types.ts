/**
 * Yumi Memory System - Type Definitions
 *
 * Core types for the memory system that allows Yumi to remember
 * facts about the user across conversations.
 */

/**
 * Categories of memories Yumi can store.
 * Each type has different decay rates and importance weights.
 */
export type MemoryType =
  | 'identity' // Name, job, location, age - never decays
  | 'preference' // Likes, dislikes, preferred tools - 90 day half-life
  | 'skill' // Technologies known, things learning - 60 day half-life
  | 'project' // Things they're working on - 30 day half-life
  | 'person' // People they mention (colleagues, family, pets) - 60 day half-life
  | 'event' // Recent happenings in their life - 7 day half-life
  | 'opinion' // Their views on topics - 14 day half-life

/**
 * A single memory stored by Yumi.
 */
export interface Memory {
  /** Unique identifier (UUID) */
  id: string

  /** Category of this memory */
  type: MemoryType

  /** The actual fact being remembered, e.g. "User is a frontend developer" */
  content: string

  /** Additional context if needed, e.g. "Mentioned while discussing React" */
  context?: string

  /** Where this memory came from */
  source: {
    /** ID of the conversation where this was extracted */
    conversationId: string
    /** ID of the specific message */
    messageId: string
    /** URL where conversation happened (optional) */
    url?: string
    /** When this was extracted */
    timestamp: number
  }

  /**
   * How important this memory is (0-1).
   * Affects retrieval priority and decay resistance.
   */
  importance: number

  /**
   * How confident we are this memory is correct (0-1).
   * Based on how explicit the information was in conversation.
   */
  confidence: number

  /** Last time this memory was accessed/used */
  lastAccessed: number

  /** Number of times this memory has been retrieved */
  accessCount: number

  /** When this memory was created */
  createdAt: number

  /**
   * Optional expiration timestamp.
   * If set, memory will be pruned after this time regardless of importance.
   */
  expiresAt?: number
}

/**
 * Result of memory extraction from a conversation.
 */
export interface ExtractionResult {
  /** Extracted memories (without generated fields like id, timestamps) */
  memories: ExtractedMemory[]

  /** Raw AI response for debugging */
  raw?: string

  /** Whether extraction was successful */
  success: boolean

  /** Error message if extraction failed */
  error?: string
}

/**
 * A memory as extracted by AI, before being stored.
 * Missing fields that are generated on save (id, timestamps, accessCount).
 */
export interface ExtractedMemory {
  type: MemoryType
  content: string
  context?: string
  importance: number
  confidence: number
}

/**
 * State of the memory system.
 */
export interface MemoryState {
  /** All stored memories */
  memories: Memory[]

  /** Whether memories have been loaded from storage */
  isLoaded: boolean

  /** Whether extraction is currently in progress */
  isExtracting: boolean

  /** Timestamp of last extraction */
  lastExtractionAt: number | null

  /** Any error from last operation */
  lastError: string | null
}

/**
 * Options for memory retrieval.
 */
export interface RetrievalOptions {
  /** Maximum number of memories to retrieve */
  limit?: number

  /** Filter by memory types */
  types?: MemoryType[]

  /** Minimum importance threshold (0-1) */
  minImportance?: number

  /** Minimum confidence threshold (0-1) */
  minConfidence?: number

  /** Include decayed importance calculation */
  applyDecay?: boolean
}

/**
 * Context for relevance-based retrieval.
 */
export interface RetrievalContext {
  /** Current user message or query */
  currentMessage: string

  /** Current page URL */
  currentUrl?: string

  /** Recent topics from conversation */
  recentTopics?: string[]

  /** Current page type (if context awareness is enabled) */
  pageType?: string
}

/**
 * Configuration for memory decay.
 * Half-life values in days for each memory type.
 */
export const MEMORY_HALF_LIFE: Record<MemoryType, number> = {
  identity: Infinity, // Never decays
  preference: 90,
  skill: 60,
  project: 30,
  person: 60,
  event: 7,
  opinion: 14,
}

/**
 * Storage limits for the memory system.
 */
export const MEMORY_LIMITS = {
  /** Maximum total memories to store */
  maxTotalMemories: 500,

  /** Maximum memories per type */
  maxMemoriesPerType: 100,

  /** Maximum storage size in bytes (5MB) */
  maxStorageBytes: 5 * 1024 * 1024,

  /** Start pruning when this percentage of limit reached */
  pruneThreshold: 0.9,

  /** Prune down to this percentage of limit */
  pruneTarget: 0.7,
}

/**
 * Configuration for memory extraction.
 */
export const EXTRACTION_CONFIG = {
  /** Minimum idle time before triggering extraction (ms) */
  idleDelayMs: 30_000,

  /** Maximum messages to process in one extraction batch */
  batchSize: 10,

  /** Minimum time between extractions (ms) */
  minExtractionInterval: 5 * 60 * 1000,

  /** Patterns to detect sensitive content that should never be stored */
  sensitivePatterns: [
    /password/i,
    /api[_-]?key/i,
    /secret/i,
    /token/i,
    /credential/i,
    /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/, // Credit card
    /\b\d{3}-\d{2}-\d{4}\b/, // SSN
  ] as RegExp[],
}

/**
 * Database configuration.
 */
export const MEMORY_DB_CONFIG = {
  /** Database name */
  dbName: 'yumi-memory',

  /** Store name for memories */
  storeName: 'memories',

  /** Current schema version */
  version: 1,
}
