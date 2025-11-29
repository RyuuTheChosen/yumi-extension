/**
 * Memory Retrieval and Injection (Phase 2: Smart Retrieval)
 *
 * Retrieves relevant memories and formats them for inclusion in AI prompts.
 * Uses keyword indexing and TF-IDF style relevance scoring.
 */

import type { Memory, MemoryType, RetrievalContext, RetrievalOptions } from './types'
import { calculateDecayedImportance } from './memoryStore'
import {
  extractKeywords,
  extractEntities,
  buildKeywordIndex,
  weightedKeywordScore,
  jaccardSimilarity,
  isTechTerm,
  getMatchingKeywords,
} from './keywords'

/**
 * Default limits for memory retrieval
 */
const DEFAULT_RETRIEVAL_LIMITS = {
  maxMemories: 15,
  maxTokensEstimate: 500, // Rough estimate of tokens for memories
  minImportance: 0.3,
  minConfidence: 0.5,
}

/**
 * Cached keyword index for efficient retrieval
 */
let cachedKeywordIndex: Map<string, number> | null = null
let cachedMemoryCount = 0

/**
 * Update the keyword index cache
 */
export function updateKeywordIndexCache(memories: Memory[]): void {
  cachedKeywordIndex = buildKeywordIndex(memories)
  cachedMemoryCount = memories.length
}

/**
 * Score a memory's relevance to the current context (Phase 2: Smart Retrieval)
 *
 * Scoring breakdown:
 * - Base importance (with decay): 25%
 * - Confidence: 10%
 * - Recency: 10%
 * - Keyword match (TF-IDF weighted): 35%
 * - Entity match boost: 10%
 * - Type relevance: 10%
 */
export function scoreRelevance(
  memory: Memory,
  context: RetrievalContext,
  keywordIndex?: Map<string, number>
): number {
  let score = 0

  // Base score from decayed importance (25%)
  const importance = calculateDecayedImportance(memory)
  score += importance * 0.25

  // Confidence contributes to score (10%)
  score += memory.confidence * 0.1

  // Recency boost (10%) - memories accessed recently get a boost
  const hoursSinceAccess =
    (Date.now() - memory.lastAccessed) / (1000 * 60 * 60)
  const recencyBoost = Math.exp(-hoursSinceAccess / 48) * 0.1 // Decays over 48 hours
  score += recencyBoost

  // Smart keyword matching (35%)
  if (context.currentMessage) {
    const index = keywordIndex || cachedKeywordIndex || new Map()

    // Extract keywords from query and memory
    const queryKeywords = extractKeywords(context.currentMessage)
    const memoryText = memory.content + ' ' + (memory.context || '')
    const memoryKeywords = extractKeywords(memoryText)

    // Weighted keyword score (TF-IDF inspired)
    const keywordScore = weightedKeywordScore(queryKeywords, memoryKeywords, index)
    score += keywordScore * 0.35

    // Entity match boost (10%) - extra points for matching names/tech
    const queryEntities = extractEntities(context.currentMessage)
    const memoryEntities = extractEntities(memoryText)

    if (queryEntities.length > 0 && memoryEntities.length > 0) {
      const entityOverlap = jaccardSimilarity(queryEntities, memoryEntities)
      score += entityOverlap * 0.1

      // Extra boost for tech term matches
      const matchedTechTerms = getMatchingKeywords(queryEntities, memoryEntities)
        .filter(k => isTechTerm(k))
      if (matchedTechTerms.length > 0) {
        score += Math.min(matchedTechTerms.length * 0.02, 0.05)
      }
    }
  }

  // Type-based relevance (10%) - identity always relevant
  const typeRelevance: Record<MemoryType, number> = {
    identity: 0.1,
    preference: 0.08,
    skill: 0.08,
    project: 0.08,
    person: 0.06,
    event: 0.04,
    opinion: 0.04,
  }
  score += typeRelevance[memory.type] || 0

  return Math.min(score, 1)
}

/**
 * Retrieve memories relevant to the current context (Phase 2: Smart Retrieval)
 */
export function retrieveRelevantMemories(
  allMemories: Memory[],
  context: RetrievalContext,
  options: RetrievalOptions = {}
): Memory[] {
  const {
    limit = DEFAULT_RETRIEVAL_LIMITS.maxMemories,
    types,
    minImportance = DEFAULT_RETRIEVAL_LIMITS.minImportance,
    minConfidence = DEFAULT_RETRIEVAL_LIMITS.minConfidence,
    applyDecay = true,
  } = options

  // Build keyword index for TF-IDF scoring (rebuild if memory count changed)
  if (!cachedKeywordIndex || cachedMemoryCount !== allMemories.length) {
    updateKeywordIndexCache(allMemories)
  }

  // Filter by types if specified
  let memories = types
    ? allMemories.filter((m) => types.includes(m.type))
    : allMemories

  // Filter by confidence
  memories = memories.filter((m) => m.confidence >= minConfidence)

  // Filter by importance (with optional decay)
  memories = memories.filter((m) => {
    const importance = applyDecay
      ? calculateDecayedImportance(m)
      : m.importance
    return importance >= minImportance
  })

  // Score and sort by relevance using the keyword index
  const scored = memories.map((memory) => ({
    memory,
    relevance: scoreRelevance(memory, context, cachedKeywordIndex || undefined),
  }))

  scored.sort((a, b) => b.relevance - a.relevance)

  // Log top matches for debugging (only in development)
  if (scored.length > 0 && context.currentMessage) {
    console.log('[Memory] Top relevance scores:', scored.slice(0, 5).map(s => ({
      content: s.memory.content.slice(0, 40) + '...',
      score: s.relevance.toFixed(3),
      type: s.memory.type,
    })))
  }

  return scored.slice(0, limit).map(({ memory }) => memory)
}

/**
 * Format memories into a natural language context string for system prompts
 */
export function buildMemoryContext(memories: Memory[]): string {
  if (memories.length === 0) {
    return ''
  }

  // Group memories by type for organized presentation
  const grouped = new Map<MemoryType, Memory[]>()

  for (const memory of memories) {
    const existing = grouped.get(memory.type) || []
    existing.push(memory)
    grouped.set(memory.type, existing)
  }

  const sections: string[] = []

  // Build sections in a natural order
  const typeOrder: MemoryType[] = [
    'identity',
    'skill',
    'project',
    'preference',
    'person',
    'event',
    'opinion',
  ]

  const typeLabels: Record<MemoryType, string> = {
    identity: 'About them',
    skill: 'Their skills',
    project: 'Their projects',
    preference: 'Their preferences',
    person: 'People they know',
    event: 'Recent events',
    opinion: 'Their views',
  }

  for (const type of typeOrder) {
    const typeMemories = grouped.get(type)
    if (!typeMemories || typeMemories.length === 0) continue

    const items = typeMemories.map((m) => `- ${m.content}`).join('\n')
    sections.push(`${typeLabels[type]}:\n${items}`)
  }

  return `What I remember about this person:\n\n${sections.join('\n\n')}`
}

/**
 * Build a concise memory context for token-constrained situations
 */
export function buildConciseMemoryContext(memories: Memory[]): string {
  if (memories.length === 0) {
    return ''
  }

  // Just list the most important facts as bullet points
  const facts = memories
    .slice(0, 10) // Limit to 10 most relevant
    .map((m) => `- ${m.content}`)
    .join('\n')

  return `What I remember:\n${facts}`
}

/**
 * Estimate token count for memories (rough approximation)
 * Assumes ~4 characters per token on average
 */
export function estimateTokenCount(memories: Memory[]): number {
  const text = memories.map((m) => m.content + (m.context || '')).join(' ')
  return Math.ceil(text.length / 4)
}

/**
 * Select memories that fit within a token budget
 */
export function selectMemoriesForContext(
  memories: Memory[],
  maxTokens: number = DEFAULT_RETRIEVAL_LIMITS.maxTokensEstimate
): Memory[] {
  const selected: Memory[] = []
  let currentTokens = 0

  // Memories should already be sorted by relevance
  for (const memory of memories) {
    const memoryTokens = estimateTokenCount([memory])

    if (currentTokens + memoryTokens > maxTokens) {
      break
    }

    selected.push(memory)
    currentTokens += memoryTokens
  }

  return selected
}

/**
 * Get memories formatted for injection into system prompt
 * This is the main function to call when building AI prompts
 */
export function getMemoriesForPrompt(
  allMemories: Memory[],
  context: RetrievalContext,
  maxTokens: number = DEFAULT_RETRIEVAL_LIMITS.maxTokensEstimate
): { memories: Memory[]; context: string } {
  // Retrieve relevant memories
  const relevant = retrieveRelevantMemories(allMemories, context)

  // Select within token budget
  const selected = selectMemoriesForContext(relevant, maxTokens)

  // Build formatted context
  const memoryContext = buildMemoryContext(selected)

  return {
    memories: selected,
    context: memoryContext,
  }
}
