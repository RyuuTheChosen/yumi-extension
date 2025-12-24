/**
 * Cross-Context Search
 *
 * Finds related past conversations based on memory links, topics, and embeddings.
 * Enables Yumi to reference relevant previous discussions.
 */

import type { ConversationSummary, Memory } from '../types'
import { createLogger } from '../../core/debug'

const log = createLogger('CrossContext')

/**
 * Related conversation with relevance score
 */
export interface RelatedConversation {
  summary: ConversationSummary
  relevanceScore: number
  matchType: 'memory' | 'topic' | 'semantic'
  matchDetails: string
}

/**
 * Options for finding related conversations
 */
export interface CrossContextOptions {
  maxResults?: number
  minRelevance?: number
  includeMemoryMatches?: boolean
  includeTopicMatches?: boolean
  includeSemanticMatches?: boolean
}

const DEFAULT_OPTIONS: Required<CrossContextOptions> = {
  maxResults: 5,
  minRelevance: 0.3,
  includeMemoryMatches: true,
  includeTopicMatches: true,
  includeSemanticMatches: true
}

/**
 * Find conversations related to specific memories
 */
export function findConversationsByMemories(
  summaries: ConversationSummary[],
  memoryIds: string[]
): RelatedConversation[] {
  const results: RelatedConversation[] = []

  for (const summary of summaries) {
    const matchingMemories = summary.memoryIds.filter(id => memoryIds.includes(id))

    if (matchingMemories.length > 0) {
      const relevance = matchingMemories.length / Math.max(memoryIds.length, summary.memoryIds.length)

      results.push({
        summary,
        relevanceScore: Math.min(1, relevance + 0.3),
        matchType: 'memory',
        matchDetails: `${matchingMemories.length} shared memories`
      })
    }
  }

  return results
}

/**
 * Find conversations with matching topics
 */
export function findConversationsByTopics(
  summaries: ConversationSummary[],
  topics: string[]
): RelatedConversation[] {
  const results: RelatedConversation[] = []
  const normalizedTopics = topics.map(t => t.toLowerCase().trim())

  for (const summary of summaries) {
    const summaryTopics = summary.keyTopics.map(t => t.toLowerCase().trim())
    const matchingTopics = normalizedTopics.filter(t =>
      summaryTopics.some(st => st.includes(t) || t.includes(st))
    )

    if (matchingTopics.length > 0) {
      const relevance = matchingTopics.length / Math.max(topics.length, summary.keyTopics.length)

      results.push({
        summary,
        relevanceScore: Math.min(1, relevance * 0.8),
        matchType: 'topic',
        matchDetails: `Topics: ${matchingTopics.join(', ')}`
      })
    }
  }

  return results
}

/**
 * Calculate cosine similarity between two embeddings
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
  return magnitude === 0 ? 0 : dotProduct / magnitude
}

/**
 * Find semantically similar conversations using embeddings
 */
export function findConversationsBySemantic(
  summaries: ConversationSummary[],
  queryEmbedding: number[],
  minSimilarity: number = 0.5
): RelatedConversation[] {
  const results: RelatedConversation[] = []

  for (const summary of summaries) {
    if (!summary.embedding) continue

    const similarity = cosineSimilarity(queryEmbedding, summary.embedding)

    if (similarity >= minSimilarity) {
      results.push({
        summary,
        relevanceScore: similarity,
        matchType: 'semantic',
        matchDetails: `${(similarity * 100).toFixed(0)}% semantic match`
      })
    }
  }

  return results
}

/**
 * Find all related conversations using multiple strategies
 */
export function findRelatedConversations(
  summaries: ConversationSummary[],
  context: {
    currentMemories?: Memory[]
    currentTopics?: string[]
    queryEmbedding?: number[]
  },
  options: CrossContextOptions = {}
): RelatedConversation[] {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const allResults: RelatedConversation[] = []
  const seenIds = new Set<string>()

  if (opts.includeMemoryMatches && context.currentMemories?.length) {
    const memoryIds = context.currentMemories.map(m => m.id)
    const memoryMatches = findConversationsByMemories(summaries, memoryIds)

    for (const match of memoryMatches) {
      if (!seenIds.has(match.summary.id)) {
        seenIds.add(match.summary.id)
        allResults.push(match)
      }
    }
  }

  if (opts.includeTopicMatches && context.currentTopics?.length) {
    const topicMatches = findConversationsByTopics(summaries, context.currentTopics)

    for (const match of topicMatches) {
      if (!seenIds.has(match.summary.id)) {
        seenIds.add(match.summary.id)
        allResults.push(match)
      } else {
        const existing = allResults.find(r => r.summary.id === match.summary.id)
        if (existing && match.relevanceScore > existing.relevanceScore) {
          existing.relevanceScore = match.relevanceScore
          existing.matchType = match.matchType
          existing.matchDetails = match.matchDetails
        }
      }
    }
  }

  if (opts.includeSemanticMatches && context.queryEmbedding) {
    const semanticMatches = findConversationsBySemantic(
      summaries,
      context.queryEmbedding,
      opts.minRelevance
    )

    for (const match of semanticMatches) {
      if (!seenIds.has(match.summary.id)) {
        seenIds.add(match.summary.id)
        allResults.push(match)
      } else {
        const existing = allResults.find(r => r.summary.id === match.summary.id)
        if (existing) {
          existing.relevanceScore = Math.max(existing.relevanceScore, match.relevanceScore)
        }
      }
    }
  }

  return allResults
    .filter(r => r.relevanceScore >= opts.minRelevance)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, opts.maxResults)
}

/**
 * Format related conversations for AI context
 */
export function formatRelatedConversationsContext(
  related: RelatedConversation[],
  maxLength: number = 500
): string {
  if (related.length === 0) return ''

  const lines: string[] = ['Related past conversations:']

  for (const rel of related) {
    const date = new Date(rel.summary.conversationEndedAt).toLocaleDateString()
    const topics = rel.summary.keyTopics.slice(0, 3).join(', ')

    lines.push(`- [${date}] ${rel.summary.summary.slice(0, 100)}...`)
    if (topics) {
      lines.push(`  Topics: ${topics}`)
    }
  }

  const result = lines.join('\n')

  if (result.length > maxLength) {
    return result.slice(0, maxLength - 3) + '...'
  }

  return result
}
