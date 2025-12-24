/**
 * Memory Usage Tracker
 *
 * Tracks when memories are used in AI responses to inform importance adjustments.
 * Usage data helps identify which memories are actually helpful.
 */

import type { Memory } from '../types'
import { FEEDBACK_CONFIG } from '../types'
import { createLogger } from '../../core/debug'

const log = createLogger('UsageTracker')

/**
 * Record that memories were used in generating a response.
 * Updates usageCount and lastUsedAt for each memory.
 *
 * @param memories - Memories that were included in the AI context
 * @param updateFn - Function to persist updates (typically store.updateMemory)
 */
export async function trackMemoryUsage(
  memories: Memory[],
  updateFn: (id: string, updates: Partial<Memory>) => Promise<void>
): Promise<void> {
  const now = Date.now()

  for (const memory of memories) {
    try {
      await updateFn(memory.id, {
        usageCount: memory.usageCount + 1,
        lastUsedAt: now,
      })
    } catch (err) {
      log.warn(`[UsageTracker] Failed to track usage for ${memory.id}:`, err)
    }
  }

  if (memories.length > 0) {
    log.log(`[UsageTracker] Tracked usage for ${memories.length} memories`)
  }
}

/**
 * Apply a feedback boost to a memory based on successful usage.
 * Called when the user accepts/continues with an AI response.
 *
 * @param memory - Memory to boost
 * @param updateFn - Function to persist updates
 */
export async function boostMemoryFeedback(
  memory: Memory,
  updateFn: (id: string, updates: Partial<Memory>) => Promise<void>
): Promise<void> {
  const newScore = Math.min(
    memory.feedbackScore + FEEDBACK_CONFIG.usageBoost,
    FEEDBACK_CONFIG.maxScore
  )

  try {
    await updateFn(memory.id, {
      feedbackScore: newScore,
    })
    log.log(`[UsageTracker] Boosted feedback for ${memory.id}: ${memory.feedbackScore.toFixed(2)} -> ${newScore.toFixed(2)}`)
  } catch (err) {
    log.warn(`[UsageTracker] Failed to boost feedback for ${memory.id}:`, err)
  }
}

/**
 * Calculate usage frequency for a memory (uses per day since creation).
 */
export function getUsageFrequency(memory: Memory): number {
  const daysSinceCreation = (Date.now() - memory.createdAt) / (1000 * 60 * 60 * 24)
  if (daysSinceCreation < 1) return memory.usageCount

  return memory.usageCount / daysSinceCreation
}

/**
 * Get memories sorted by usage frequency (most used first).
 */
export function sortByUsage(memories: Memory[]): Memory[] {
  return [...memories].sort((a, b) => {
    const freqA = getUsageFrequency(a)
    const freqB = getUsageFrequency(b)
    return freqB - freqA
  })
}

/**
 * Identify stale memories that haven't been used recently.
 *
 * @param memories - All memories
 * @param staleDays - Number of days without usage to be considered stale
 * @returns Stale memories
 */
export function findStaleMemories(
  memories: Memory[],
  staleDays: number = 30
): Memory[] {
  const staleThreshold = Date.now() - (staleDays * 24 * 60 * 60 * 1000)

  return memories.filter(memory => {
    /** Identity memories are never stale */
    if (memory.type === 'identity') return false

    /** If never used, check creation date */
    const lastActivity = memory.lastUsedAt ?? memory.createdAt

    return lastActivity < staleThreshold
  })
}
