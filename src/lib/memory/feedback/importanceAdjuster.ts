/**
 * Memory Importance Adjuster
 *
 * Calculates effective importance for memories based on feedback data.
 * Combines base importance with usage patterns and user feedback.
 */

import type { Memory, MemoryType } from '../types'
import { MEMORY_HALF_LIFE, FEEDBACK_CONFIG } from '../types'
import {
  calculateEffectiveImportanceWithAdaptiveDecay,
  recordPositiveInteraction,
  recordNegativeInteraction
} from '../learning'

/**
 * Calculate the effective importance of a memory.
 *
 * Combines:
 * - Base importance (set during extraction)
 * - Time decay (based on memory type half-life)
 * - Usage frequency bonus
 * - User feedback score
 * - User verification bonus
 *
 * @param memory - Memory to calculate importance for
 * @returns Effective importance (0-1)
 */
export function calculateEffectiveImportance(memory: Memory): number {
  const { type, importance, feedbackScore, userVerified, usageCount, lastAccessed } = memory

  /** Start with base importance */
  let effective = importance

  /** Apply time decay based on memory type */
  const halfLife = MEMORY_HALF_LIFE[type]
  if (halfLife !== Infinity) {
    const daysSinceAccess = (Date.now() - lastAccessed) / (1000 * 60 * 60 * 24)
    const decayFactor = Math.pow(0.5, daysSinceAccess / halfLife)
    effective *= decayFactor
  }

  /** Add usage frequency bonus (max 0.2) */
  const usageBonus = Math.min(usageCount * 0.02, 0.2)
  effective += usageBonus

  /**
   * Apply feedback score adjustment.
   * Positive feedback boosts importance, negative reduces it.
   * Scale: feedbackScore of 1.0 gives +0.3, -1.0 gives -0.3
   */
  const feedbackAdjustment = feedbackScore * 0.3
  effective += feedbackAdjustment

  /** Apply verified memory multiplier */
  if (userVerified) {
    effective *= FEEDBACK_CONFIG.verifiedMultiplier
  }

  /** Clamp to valid range */
  return Math.max(0, Math.min(1, effective))
}

/**
 * Adjust feedback score when user engages with a proactive message.
 *
 * @param memory - Memory that triggered the proactive message
 * @param engaged - Whether user engaged (true) or dismissed (false)
 * @returns New feedback score
 */
export function adjustFeedbackScore(
  memory: Memory,
  engaged: boolean
): number {
  const adjustment = engaged
    ? FEEDBACK_CONFIG.engageBoost
    : FEEDBACK_CONFIG.dismissPenalty

  const newScore = memory.feedbackScore + adjustment

  return Math.max(
    FEEDBACK_CONFIG.minScore,
    Math.min(FEEDBACK_CONFIG.maxScore, newScore)
  )
}

/**
 * Rank memories by effective importance.
 *
 * @param memories - Memories to rank
 * @returns Memories sorted by effective importance (highest first)
 */
export function rankByEffectiveImportance(memories: Memory[]): Memory[] {
  return [...memories].sort((a, b) => {
    return calculateEffectiveImportance(b) - calculateEffectiveImportance(a)
  })
}

/**
 * Get the feedback adjustment multiplier for a memory type.
 * Some types should be more resistant to feedback changes.
 */
export function getFeedbackResistance(type: MemoryType): number {
  switch (type) {
    case 'identity':
      return 0.5
    case 'preference':
      return 0.7
    case 'skill':
    case 'person':
      return 0.8
    case 'project':
    case 'opinion':
    case 'event':
    default:
      return 1.0
  }
}

/**
 * Decay feedback score over time.
 * Old feedback should gradually move toward neutral (0).
 *
 * @param memory - Memory with feedback
 * @param decayDays - Number of days for feedback to decay
 * @returns Decayed feedback score
 */
export function decayFeedbackScore(
  memory: Memory,
  decayDays: number = 60
): number {
  if (!memory.lastUsedAt) return memory.feedbackScore

  const daysSinceUsed = (Date.now() - memory.lastUsedAt) / (1000 * 60 * 60 * 24)
  const decayFactor = Math.pow(0.5, daysSinceUsed / decayDays)

  return memory.feedbackScore * decayFactor
}

/**
 * Calculate suggested importance adjustment based on feedback.
 * Returns a delta that could be applied to base importance.
 */
export function suggestImportanceAdjustment(memory: Memory): number {
  const {feedbackScore, usageCount, userVerified} = memory

  /** High positive feedback + high usage = boost */
  if (feedbackScore > 0.3 && usageCount > 5) {
    return 0.1
  }

  /** User verified memories get slight boost */
  if (userVerified && feedbackScore >= 0) {
    return 0.05
  }

  /** Negative feedback = reduce */
  if (feedbackScore < -0.3) {
    return -0.1
  }

  /** High usage but neutral feedback = small boost */
  if (usageCount > 10 && feedbackScore >= 0) {
    return 0.05
  }

  return 0
}

/**
 * Record feedback and interaction for adaptive learning.
 * Updates both the feedback score and interaction counts.
 *
 * @param memory - Memory to update
 * @param engaged - Whether user engaged positively
 * @returns Partial memory update to apply
 */
export function recordFeedbackWithInteraction(
  memory: Memory,
  engaged: boolean
): Partial<Memory> {
  const newScore = adjustFeedbackScore(memory, engaged)
  const interactionUpdate = engaged
    ? recordPositiveInteraction(memory)
    : recordNegativeInteraction(memory)

  return {
    feedbackScore: newScore,
    ...interactionUpdate
  }
}

/**
 * Calculate effective importance using adaptive decay.
 * This is the recommended method for scoring memories.
 */
export { calculateEffectiveImportanceWithAdaptiveDecay }
