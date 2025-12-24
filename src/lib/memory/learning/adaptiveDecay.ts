/**
 * Adaptive Decay System
 *
 * Calculates memory decay rates based on usage patterns.
 * Frequently used memories decay slower, unused memories decay faster.
 */

import type { Memory } from '../types'
import { MEMORY_HALF_LIFE, ADAPTIVE_DECAY_CONFIG } from '../types'
import { createLogger } from '../../core/debug'

const log = createLogger('AdaptiveDecay')

const {
  minDecayRate,
  maxDecayRate,
  defaultDecayRate,
  positiveWeight,
  negativeWeight,
  usageThreshold,
  staleThresholdDays,
  staleDecayMultiplier
} = ADAPTIVE_DECAY_CONFIG

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Calculate adaptive decay rate for a memory based on interaction history.
 * Returns a multiplier where:
 * - < 1.0 = slower decay (frequently used)
 * - 1.0 = normal decay
 * - > 1.0 = faster decay (rarely used)
 */
export function calculateAdaptiveDecayRate(memory: Memory): number {
  const positive = memory.positiveInteractions ?? 0
  const negative = memory.negativeInteractions ?? 0
  const usageCount = memory.usageCount ?? 0

  if (positive === 0 && negative === 0 && usageCount < usageThreshold) {
    return defaultDecayRate
  }

  let rate = defaultDecayRate

  rate -= positive * positiveWeight

  rate += negative * negativeWeight

  if (usageCount >= usageThreshold) {
    const usageBonus = Math.min(usageCount * 0.02, 0.3)
    rate -= usageBonus
  }

  const daysSinceAccess = (Date.now() - memory.lastAccessed) / MS_PER_DAY
  if (daysSinceAccess > staleThresholdDays && usageCount < usageThreshold) {
    rate *= staleDecayMultiplier
  }

  return Math.max(minDecayRate, Math.min(maxDecayRate, rate))
}

/**
 * Calculate decayed importance with adaptive rate.
 * This replaces the simple half-life calculation with one that
 * considers usage patterns.
 */
export function calculateAdaptiveDecayedImportance(memory: Memory): number {
  const halfLifeDays = MEMORY_HALF_LIFE[memory.type]

  if (!Number.isFinite(halfLifeDays)) {
    return memory.importance
  }

  const ageInDays = (Date.now() - memory.createdAt) / MS_PER_DAY
  const adaptiveRate = memory.adaptiveDecayRate ?? calculateAdaptiveDecayRate(memory)

  const adjustedHalfLife = halfLifeDays / adaptiveRate

  const decayFactor = Math.pow(0.5, ageInDays / adjustedHalfLife)

  return memory.importance * decayFactor
}

/**
 * Update a memory's adaptive decay rate based on current state.
 * Should be called periodically or when significant interactions occur.
 */
export function updateMemoryDecayRate(memory: Memory): Partial<Memory> {
  const newRate = calculateAdaptiveDecayRate(memory)
  const currentRate = memory.adaptiveDecayRate ?? defaultDecayRate

  if (Math.abs(newRate - currentRate) < 0.05) {
    return {}
  }

  log.log(`[AdaptiveDecay] Updated rate for memory ${memory.id}: ${currentRate.toFixed(2)} -> ${newRate.toFixed(2)}`)

  return { adaptiveDecayRate: newRate }
}

/**
 * Record a positive interaction (memory was useful)
 */
export function recordPositiveInteraction(memory: Memory): Partial<Memory> {
  const current = memory.positiveInteractions ?? 0
  return {
    positiveInteractions: current + 1,
    lastUsedAt: Date.now()
  }
}

/**
 * Record a negative interaction (memory was dismissed/ignored)
 */
export function recordNegativeInteraction(memory: Memory): Partial<Memory> {
  const current = memory.negativeInteractions ?? 0
  return {
    negativeInteractions: current + 1
  }
}

/**
 * Find memories that should have accelerated decay applied.
 * These are memories that haven't been used in a while and have low usage.
 */
export function findStaleMemories(memories: Memory[]): Memory[] {
  const now = Date.now()
  const staleThresholdMs = staleThresholdDays * MS_PER_DAY

  return memories.filter(memory => {
    if (!Number.isFinite(MEMORY_HALF_LIFE[memory.type])) {
      return false
    }

    const timeSinceAccess = now - memory.lastAccessed
    const usageCount = memory.usageCount ?? 0

    return timeSinceAccess > staleThresholdMs && usageCount < usageThreshold
  })
}

/**
 * Calculate the effective importance combining:
 * - Base importance
 * - Adaptive decay
 * - Feedback score
 * - User verification bonus
 */
export function calculateEffectiveImportanceWithAdaptiveDecay(memory: Memory): number {
  const decayedImportance = calculateAdaptiveDecayedImportance(memory)

  const feedbackAdjustment = (memory.feedbackScore ?? 0) * 0.2

  const verifiedMultiplier = memory.userVerified ? 1.5 : 1.0

  return Math.min(1, Math.max(0, (decayedImportance + feedbackAdjustment) * verifiedMultiplier))
}
