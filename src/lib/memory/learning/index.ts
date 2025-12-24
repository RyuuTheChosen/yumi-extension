/**
 * Memory Learning Module
 *
 * Provides adaptive decay and importance prediction for memories.
 * Learns from usage patterns to optimize memory value over time.
 */

export {
  calculateAdaptiveDecayRate,
  calculateAdaptiveDecayedImportance,
  updateMemoryDecayRate,
  recordPositiveInteraction,
  recordNegativeInteraction,
  findStaleMemories,
  calculateEffectiveImportanceWithAdaptiveDecay
} from './adaptiveDecay'

export {
  analyzeMemoryStats,
  predictImportance,
  identifyLowValueMemories,
  identifyHighValueMemories,
  getLearningInsights,
  type MemoryTypeStats,
  type ImportancePrediction
} from './importanceLearner'
