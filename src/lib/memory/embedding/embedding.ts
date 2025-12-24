/**
 * Embedding Generation Module
 *
 * Generates vector embeddings for memories via Hub API.
 * Uses text-embedding-3-small model (1536 dimensions).
 */

import { createLogger } from '../../core/debug'
import { EMBEDDING_CONFIG } from '../types'
import type { Memory } from '../types'

const log = createLogger('Embedding')

/**
 * Result of embedding generation
 */
export interface EmbeddingResult {
  success: boolean
  embedding?: number[]
  model?: string
  error?: string
}

/**
 * Batch embedding result
 */
export interface BatchEmbeddingResult {
  success: boolean
  embeddings: Map<string, number[]>
  model?: string
  error?: string
  failedIds: string[]
}

/**
 * Generate embedding for a single text via Hub API
 */
export async function generateEmbedding(
  text: string,
  hubUrl: string,
  accessToken: string
): Promise<EmbeddingResult> {
  try {
    const response = await fetch(`${hubUrl}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'X-Yumi-Request-Type': 'memory-embedding',
      },
      body: JSON.stringify({
        input: text,
        model: 'text-embedding-3-small',
      }),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error')
      return { success: false, error: `API error ${response.status}: ${errText}` }
    }

    const json = await response.json()
    const embedding = json.data?.[0]?.embedding

    if (!embedding || !Array.isArray(embedding)) {
      return { success: false, error: 'Invalid embedding response format' }
    }

    return {
      success: true,
      embedding,
      model: EMBEDDING_CONFIG.modelVersion,
    }
  } catch (err) {
    log.error('[Embedding] Generation failed:', err)
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

/**
 * Generate embeddings for multiple texts in a batch
 */
export async function generateEmbeddingsBatch(
  texts: string[],
  hubUrl: string,
  accessToken: string
): Promise<{ success: boolean; embeddings: number[][]; model?: string; error?: string }> {
  if (texts.length === 0) {
    return { success: true, embeddings: [], model: EMBEDDING_CONFIG.modelVersion }
  }

  try {
    const response = await fetch(`${hubUrl}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'X-Yumi-Request-Type': 'memory-embedding',
      },
      body: JSON.stringify({
        input: texts,
        model: 'text-embedding-3-small',
      }),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error')
      return { success: false, embeddings: [], error: `API error ${response.status}: ${errText}` }
    }

    const json = await response.json()
    const embeddings = json.data?.map((d: { embedding: number[] }) => d.embedding)

    if (!embeddings || !Array.isArray(embeddings)) {
      return { success: false, embeddings: [], error: 'Invalid batch embedding response format' }
    }

    return {
      success: true,
      embeddings,
      model: EMBEDDING_CONFIG.modelVersion,
    }
  } catch (err) {
    log.error('[Embedding] Batch generation failed:', err)
    return {
      success: false,
      embeddings: [],
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

/**
 * Build text for embedding from a memory
 * Combines content and context for richer semantic representation
 */
export function buildEmbeddingText(memory: Memory): string {
  const parts = [memory.content]

  if (memory.context) {
    parts.push(memory.context)
  }

  parts.push(`Type: ${memory.type}`)

  return parts.join(' | ')
}

/**
 * Calculate cosine similarity between two embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  return denominator === 0 ? 0 : dotProduct / denominator
}

/**
 * Find memories with similar embeddings
 */
export function findSimilarByEmbedding(
  queryEmbedding: number[],
  memories: Memory[],
  topK: number = 10,
  minSimilarity: number = EMBEDDING_CONFIG.minSimilarity
): Array<{ memory: Memory; similarity: number }> {
  const results: Array<{ memory: Memory; similarity: number }> = []

  for (const memory of memories) {
    if (!memory.embedding) continue

    const similarity = cosineSimilarity(queryEmbedding, memory.embedding)

    if (similarity >= minSimilarity) {
      results.push({ memory, similarity })
    }
  }

  results.sort((a, b) => b.similarity - a.similarity)

  return results.slice(0, topK)
}

/**
 * Check if a memory needs embedding generation or regeneration
 */
export function needsEmbedding(memory: Memory): boolean {
  if (!memory.embedding) return true

  if (memory.embeddingModel !== EMBEDDING_CONFIG.modelVersion) return true

  return false
}

/**
 * Get memories that need embeddings
 */
export function getMemoriesNeedingEmbeddings(memories: Memory[]): Memory[] {
  return memories.filter(needsEmbedding)
}
