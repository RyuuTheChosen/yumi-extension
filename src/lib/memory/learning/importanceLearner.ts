/**
 * Importance Learner
 *
 * Learns from historical memory usage to predict importance of new memories.
 * Uses patterns from high-value memories to inform extraction.
 */

import type { Memory, MemoryType } from '../types'
import { ADAPTIVE_DECAY_CONFIG } from '../types'
import { createLogger } from '../../core/debug'

const log = createLogger('ImportanceLearner')

/**
 * Statistics about memory types and their success rates
 */
export interface MemoryTypeStats {
  type: MemoryType
  totalCount: number
  avgUsageCount: number
  avgPositiveInteractions: number
  avgFeedbackScore: number
  successRate: number
}

/**
 * Prediction about how valuable a memory will be
 */
export interface ImportancePrediction {
  suggestedImportance: number
  confidence: number
  reason: string
}

/**
 * Calculate success rate for a memory (0-1)
 * Success = high usage + positive feedback + verified
 */
function calculateMemorySuccessRate(memory: Memory): number {
  const usageScore = Math.min((memory.usageCount ?? 0) / 10, 1)
  const feedbackScore = ((memory.feedbackScore ?? 0) + 1) / 2
  const verifiedScore = memory.userVerified ? 1 : 0
  const positiveScore = Math.min((memory.positiveInteractions ?? 0) / 5, 1)

  return (usageScore * 0.3) + (feedbackScore * 0.3) + (verifiedScore * 0.2) + (positiveScore * 0.2)
}

/**
 * Analyze memories to build statistics by type
 */
export function analyzeMemoryStats(memories: Memory[]): MemoryTypeStats[] {
  const typeGroups = new Map<MemoryType, Memory[]>()

  for (const memory of memories) {
    const group = typeGroups.get(memory.type) || []
    group.push(memory)
    typeGroups.set(memory.type, group)
  }

  const stats: MemoryTypeStats[] = []

  for (const [type, group] of typeGroups) {
    if (group.length === 0) continue

    const totalUsage = group.reduce((sum, m) => sum + (m.usageCount ?? 0), 0)
    const totalPositive = group.reduce((sum, m) => sum + (m.positiveInteractions ?? 0), 0)
    const totalFeedback = group.reduce((sum, m) => sum + (m.feedbackScore ?? 0), 0)
    const successRates = group.map(calculateMemorySuccessRate)
    const avgSuccessRate = successRates.reduce((a, b) => a + b, 0) / successRates.length

    stats.push({
      type,
      totalCount: group.length,
      avgUsageCount: totalUsage / group.length,
      avgPositiveInteractions: totalPositive / group.length,
      avgFeedbackScore: totalFeedback / group.length,
      successRate: avgSuccessRate
    })
  }

  return stats.sort((a, b) => b.successRate - a.successRate)
}

/**
 * Predict importance for a new memory based on historical patterns
 */
export function predictImportance(
  memoryType: MemoryType,
  content: string,
  stats: MemoryTypeStats[]
): ImportancePrediction {
  const typeStat = stats.find(s => s.type === memoryType)

  if (!typeStat || typeStat.totalCount < 3) {
    return {
      suggestedImportance: 0.5,
      confidence: 0.3,
      reason: 'Insufficient historical data for this memory type'
    }
  }

  let baseImportance = 0.5

  baseImportance += (typeStat.successRate - 0.5) * 0.3

  const contentLength = content.length
  if (contentLength > 50 && contentLength < 200) {
    baseImportance += 0.05
  }

  const confidence = Math.min(typeStat.totalCount / 20, 1) * 0.8

  const suggestedImportance = Math.max(0.3, Math.min(0.9, baseImportance))

  return {
    suggestedImportance,
    confidence,
    reason: `Based on ${typeStat.totalCount} ${memoryType} memories with ${(typeStat.successRate * 100).toFixed(0)}% success rate`
  }
}

/**
 * Identify memories that are candidates for cleanup (low value)
 */
export function identifyLowValueMemories(
  memories: Memory[],
  threshold: number = 0.2
): Memory[] {
  return memories.filter(memory => {
    const successRate = calculateMemorySuccessRate(memory)

    const ageInDays = (Date.now() - memory.createdAt) / (24 * 60 * 60 * 1000)

    if (ageInDays < 7) return false

    return successRate < threshold && (memory.usageCount ?? 0) === 0
  })
}

/**
 * Identify high-value memories (should be protected from decay)
 */
export function identifyHighValueMemories(
  memories: Memory[],
  threshold: number = 0.7
): Memory[] {
  return memories.filter(memory => {
    const successRate = calculateMemorySuccessRate(memory)
    return successRate >= threshold || memory.userVerified
  })
}

/**
 * Get learning insights from memory patterns
 */
export function getLearningInsights(memories: Memory[]): {
  mostSuccessfulTypes: MemoryType[]
  leastSuccessfulTypes: MemoryType[]
  avgSuccessRate: number
  recommendedImportanceAdjustment: number
} {
  const stats = analyzeMemoryStats(memories)

  if (stats.length === 0) {
    return {
      mostSuccessfulTypes: [],
      leastSuccessfulTypes: [],
      avgSuccessRate: 0.5,
      recommendedImportanceAdjustment: 0
    }
  }

  const totalSuccess = stats.reduce((sum, s) => sum + s.successRate * s.totalCount, 0)
  const totalCount = stats.reduce((sum, s) => sum + s.totalCount, 0)
  const avgSuccessRate = totalCount > 0 ? totalSuccess / totalCount : 0.5

  const sortedStats = [...stats].sort((a, b) => b.successRate - a.successRate)

  const mostSuccessfulTypes = sortedStats
    .slice(0, 2)
    .filter(s => s.successRate > 0.5)
    .map(s => s.type)

  const leastSuccessfulTypes = sortedStats
    .slice(-2)
    .filter(s => s.successRate < 0.3)
    .map(s => s.type)

  let recommendedImportanceAdjustment = 0
  if (avgSuccessRate > 0.6) {
    recommendedImportanceAdjustment = -0.1
  } else if (avgSuccessRate < 0.4) {
    recommendedImportanceAdjustment = 0.1
  }

  return {
    mostSuccessfulTypes,
    leastSuccessfulTypes,
    avgSuccessRate,
    recommendedImportanceAdjustment
  }
}
