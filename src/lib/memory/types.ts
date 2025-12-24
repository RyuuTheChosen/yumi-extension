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

  /**
   * Number of times this memory was included in AI context.
   * Different from accessCount which tracks retrieval attempts.
   */
  usageCount: number

  /**
   * Last time this memory was actually used in an AI response.
   * Undefined if never used in a response.
   */
  lastUsedAt?: number

  /**
   * Aggregated user feedback score (-1 to 1).
   * Positive = memory was helpful, negative = memory was not useful.
   * Starts at 0 and adjusts based on user actions.
   */
  feedbackScore: number

  /**
   * Whether this memory has been verified/edited by the user.
   * User-verified memories get higher trust and slower decay.
   */
  userVerified: boolean

  /**
   * Vector embedding for semantic search (1536 floats for text-embedding-3-small).
   * Generated on demand, undefined means not yet computed.
   */
  embedding?: number[]

  /**
   * Model used to generate the embedding.
   * Used to detect when embeddings need regeneration after model updates.
   */
  embeddingModel?: string

  /**
   * Adaptive decay rate multiplier (0.5 to 2.0).
   * < 1.0 = slower decay (frequently used memories)
   * > 1.0 = faster decay (rarely used memories)
   * Undefined = use default rate (1.0)
   */
  adaptiveDecayRate?: number

  /**
   * Count of positive interactions (used in response, user engaged).
   * Used to calculate adaptive decay rate.
   */
  positiveInteractions?: number

  /**
   * Count of negative interactions (dismissed, ignored when retrieved).
   * Used to calculate adaptive decay rate.
   */
  negativeInteractions?: number
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

  /** If true, only return memories from the same site origin */
  scopeToSite?: boolean

  /** Optional query embedding for semantic search */
  queryEmbedding?: number[]
}

/**
 * Context for relevance-based retrieval.
 */
export interface RetrievalContext {
  /** Current user message or query */
  currentMessage: string

  /** Current page URL */
  currentUrl?: string

  /** Site origin for scoped retrieval (e.g., "https://example.com") */
  siteOrigin?: string

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

  /** Maximum extractions allowed per hour (rate limit) */
  maxExtractionsPerHour: 12,

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

  /** Store name for entity links */
  entitiesStoreName: 'entities',

  /** Store name for conversation summaries */
  summariesStoreName: 'conversation-summaries',

  /** Current schema version (v6 adds conversation summaries) */
  version: 6,
}

/**
 * Configuration for feedback scoring.
 */
export const FEEDBACK_CONFIG = {
  /** Amount to boost score when user engages with proactive message */
  engageBoost: 0.1,

  /** Amount to decrease score when user dismisses proactive message */
  dismissPenalty: -0.05,

  /** Amount to boost score when memory is used in successful response */
  usageBoost: 0.02,

  /** Multiplier for user-verified memories in importance calculation */
  verifiedMultiplier: 1.5,

  /** Maximum absolute feedback score */
  maxScore: 1.0,

  /** Minimum absolute feedback score */
  minScore: -1.0,
}

/**
 * Configuration for embedding system.
 */
export const EMBEDDING_CONFIG = {
  /** Embedding vector dimensions (text-embedding-3-small) */
  dimensions: 1536,

  /** Maximum texts to embed in one API call */
  batchSize: 10,

  /** Weight for semantic similarity in hybrid search (0-1) */
  semanticWeight: 0.6,

  /** Weight for keyword similarity in hybrid search (0-1) */
  keywordWeight: 0.4,

  /** Minimum similarity score to consider a match */
  minSimilarity: 0.3,

  /** Current embedding model version for cache invalidation */
  modelVersion: 'text-embedding-3-small-v1',
}

/**
 * Entity types that can be extracted from memories
 */
export type EntityType = 'person' | 'project' | 'skill' | 'technology'

/**
 * An entity extracted from memory content.
 * Used to group related memories by shared entities.
 */
export interface EntityLink {
  /** Unique identifier for this entity (hash of normalized name + type) */
  entityId: string

  /** Type of entity */
  entityType: EntityType

  /** Normalized entity name (e.g., "react", "john smith") */
  entityName: string

  /** Display name as originally extracted */
  displayName: string

  /** IDs of memories that mention this entity */
  memoryIds: string[]

  /** When this entity link was first created */
  createdAt: number

  /** When this entity link was last updated */
  updatedAt: number
}

/**
 * Configuration for entity clustering.
 */
export const CLUSTERING_CONFIG = {
  /** Minimum entity name length to consider */
  minEntityLength: 2,

  /** Maximum entities to extract per memory */
  maxEntitiesPerMemory: 10,

  /** Minimum related memories to show in UI */
  minRelatedMemories: 1,

  /** Maximum related memories to show in UI */
  maxRelatedMemories: 10,
}

/**
 * Configuration for adaptive decay learning.
 */
export const ADAPTIVE_DECAY_CONFIG = {
  /** Minimum decay rate multiplier (highly used memories decay slower) */
  minDecayRate: 0.5,

  /** Maximum decay rate multiplier (unused memories decay faster) */
  maxDecayRate: 2.0,

  /** Default decay rate when no interaction data */
  defaultDecayRate: 1.0,

  /** Weight of positive interactions in rate calculation */
  positiveWeight: 0.15,

  /** Weight of negative interactions in rate calculation */
  negativeWeight: 0.1,

  /** Usage count threshold for decay rate adjustment */
  usageThreshold: 3,

  /** Days without access to trigger accelerated decay */
  staleThresholdDays: 30,

  /** Decay acceleration for stale memories */
  staleDecayMultiplier: 1.5,
}

/**
 * A summary of a conversation for context linking.
 */
export interface ConversationSummary {
  /** Unique identifier */
  id: string

  /** ID of the conversation this summarizes */
  conversationId: string

  /** Generated summary text */
  summary: string

  /** Key topics discussed */
  keyTopics: string[]

  /** IDs of memories extracted from this conversation */
  memoryIds: string[]

  /** Number of messages in the conversation */
  messageCount: number

  /** URL where conversation happened */
  url?: string

  /** When the conversation started */
  conversationStartedAt: number

  /** When the conversation ended */
  conversationEndedAt: number

  /** When this summary was created */
  createdAt: number

  /** Embedding for semantic search on summaries */
  embedding?: number[]
}

/**
 * Configuration for conversation summaries.
 */
export const SUMMARY_CONFIG = {
  /** Minimum messages to trigger summary generation */
  minMessagesForSummary: 10,

  /** Maximum summary length in characters */
  maxSummaryLength: 500,

  /** Maximum key topics to extract */
  maxKeyTopics: 5,

  /** Store name for summaries */
  summariesStoreName: 'conversation-summaries',
}
