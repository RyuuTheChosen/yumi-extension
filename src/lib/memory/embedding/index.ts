/**
 * Memory Embedding System
 *
 * Provides semantic search capabilities using vector embeddings.
 */

export {
  generateEmbedding,
  generateEmbeddingsBatch,
  buildEmbeddingText,
  cosineSimilarity,
  findSimilarByEmbedding,
  needsEmbedding,
  getMemoriesNeedingEmbeddings,
  type EmbeddingResult,
  type BatchEmbeddingResult,
} from './embedding'

export {
  hybridSearch,
  scoreMemoryHybrid,
  getSemanticBoost,
  canUseSemanticSearch,
  getEmbeddingStats,
  type HybridSearchResult,
} from './hybridSearch'
