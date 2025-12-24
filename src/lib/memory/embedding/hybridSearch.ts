/**
 * Hybrid Search Module
 *
 * Combines semantic embedding similarity with keyword matching
 * for more accurate memory retrieval.
 */

import type { Memory, RetrievalContext } from '../types'
import { EMBEDDING_CONFIG } from '../types'
import { cosineSimilarity } from './embedding'
import { extractKeywords, weightedKeywordScore, buildKeywordIndex } from '../retrieval/keywords'
import { createLogger } from '../../core/debug'

const log = createLogger('HybridSearch')

/**
 * Scored memory result from hybrid search
 */
export interface HybridSearchResult {
  memory: Memory
  score: number
  semanticScore: number
  keywordScore: number
}

/**
 * Perform hybrid search combining semantic and keyword matching
 *
 * @param queryEmbedding - Embedding of the search query (optional, falls back to keyword-only)
 * @param queryText - Text of the search query
 * @param memories - All memories to search through
 * @param options - Search configuration options
 */
export function hybridSearch(
  queryEmbedding: number[] | undefined,
  queryText: string,
  memories: Memory[],
  options: {
    semanticWeight?: number
    keywordWeight?: number
    minScore?: number
    limit?: number
  } = {}
): HybridSearchResult[] {
  const {
    semanticWeight = EMBEDDING_CONFIG.semanticWeight,
    keywordWeight = EMBEDDING_CONFIG.keywordWeight,
    minScore = EMBEDDING_CONFIG.minSimilarity,
    limit = 20,
  } = options

  const queryKeywords = extractKeywords(queryText)
  const keywordIndex = buildKeywordIndex(memories)

  const results: HybridSearchResult[] = []

  for (const memory of memories) {
    let semanticScore = 0
    let keywordScore = 0

    /** Semantic similarity (if both embeddings available) */
    if (queryEmbedding && memory.embedding) {
      semanticScore = cosineSimilarity(queryEmbedding, memory.embedding)
    }

    /** Keyword matching */
    const memoryText = memory.content + ' ' + (memory.context || '')
    const memoryKeywords = extractKeywords(memoryText)
    keywordScore = weightedKeywordScore(queryKeywords, memoryKeywords, keywordIndex)

    /** Calculate combined score */
    let combinedScore: number

    if (queryEmbedding && memory.embedding) {
      combinedScore = semanticScore * semanticWeight + keywordScore * keywordWeight
    } else {
      /** Fall back to keyword-only when embeddings unavailable */
      combinedScore = keywordScore
    }

    if (combinedScore >= minScore) {
      results.push({
        memory,
        score: combinedScore,
        semanticScore,
        keywordScore,
      })
    }
  }

  results.sort((a, b) => b.score - a.score)

  return results.slice(0, limit)
}

/**
 * Score a single memory against a query using hybrid approach
 */
export function scoreMemoryHybrid(
  memory: Memory,
  queryEmbedding: number[] | undefined,
  queryText: string,
  keywordIndex: Map<string, number>
): { score: number; semanticScore: number; keywordScore: number } {
  let semanticScore = 0
  let keywordScore = 0

  /** Semantic similarity */
  if (queryEmbedding && memory.embedding) {
    semanticScore = cosineSimilarity(queryEmbedding, memory.embedding)
  }

  /** Keyword matching */
  const queryKeywords = extractKeywords(queryText)
  const memoryText = memory.content + ' ' + (memory.context || '')
  const memoryKeywords = extractKeywords(memoryText)
  keywordScore = weightedKeywordScore(queryKeywords, memoryKeywords, keywordIndex)

  /** Combine scores */
  let score: number

  if (queryEmbedding && memory.embedding) {
    score =
      semanticScore * EMBEDDING_CONFIG.semanticWeight +
      keywordScore * EMBEDDING_CONFIG.keywordWeight
  } else {
    score = keywordScore
  }

  return { score, semanticScore, keywordScore }
}

/**
 * Calculate semantic similarity boost for retrieval scoring
 * Returns a normalized boost value (0-1) that can be added to existing scores
 */
export function getSemanticBoost(
  memory: Memory,
  queryEmbedding: number[] | undefined,
  maxBoost: number = 0.3
): number {
  if (!queryEmbedding || !memory.embedding) {
    return 0
  }

  const similarity = cosineSimilarity(queryEmbedding, memory.embedding)

  /** Scale similarity to boost value (only positive contributions) */
  return Math.max(0, similarity) * maxBoost
}

/**
 * Check if hybrid search can use semantic matching
 * (requires both query embedding and at least one memory with embedding)
 */
export function canUseSemanticSearch(
  queryEmbedding: number[] | undefined,
  memories: Memory[]
): boolean {
  if (!queryEmbedding) return false

  return memories.some((m) => m.embedding !== undefined)
}

/**
 * Get statistics about embedding coverage in memories
 */
export function getEmbeddingStats(memories: Memory[]): {
  total: number
  withEmbedding: number
  withoutEmbedding: number
  coverage: number
} {
  const withEmbedding = memories.filter((m) => m.embedding !== undefined).length
  const withoutEmbedding = memories.length - withEmbedding
  const coverage = memories.length > 0 ? withEmbedding / memories.length : 0

  return {
    total: memories.length,
    withEmbedding,
    withoutEmbedding,
    coverage,
  }
}
