/**
 * Feature Flag System
 *
 * Enables gradual rollout of new features to minimize risk of bugs.
 * Supports percentage-based rollouts, user allow-lists, and easy enable/disable.
 *
 * @example
 * ```typescript
 * import { isFeatureEnabled } from './lib/featureFlags'
 *
 * if (isFeatureEnabled('virtualScrolling', userId)) {
 *   return <VirtualMessageList />
 * } else {
 *   return <RegularMessageList />
 * }
 * ```
 */

import { createLogger } from '../core/debug'

const log = createLogger('FeatureFlags')

/**
 * Available feature flags
 */
export type FeatureFlag =
  | 'virtualScrolling'
  | 'newMemorySystem'
  | 'avatarCodeSplit'
  | 'optimizedStorage'
  | 'enhancedErrorBoundary'
  | 'improvedCaching'

/**
 * Feature flag configuration
 */
interface FeatureFlagConfig {
  enabled: boolean
  rolloutPercentage?: number // 0-100, percentage of users to enable feature for
  allowList?: string[] // User IDs that always have the feature enabled (for testing)
  description?: string // Human-readable description of the feature
}

/**
 * Feature flag registry
 *
 * To roll out a new feature:
 * 1. Week 1: Set enabled: false, test with allowList only
 * 2. Week 2: Set rolloutPercentage: 10 (canary - monitor for issues)
 * 3. Week 3: Set rolloutPercentage: 50 (if no issues)
 * 4. Week 4: Set rolloutPercentage: 100 (full rollout)
 * 5. After stable: Remove flag from code, set enabled: true permanently
 */
const FLAGS: Record<FeatureFlag, FeatureFlagConfig> = {
  virtualScrolling: {
    enabled: false,
    rolloutPercentage: 0,
    description: 'Virtual scrolling for message list (Phase 2.2)',
  },
  newMemorySystem: {
    enabled: false,
    rolloutPercentage: 0,
    description: 'Optimized memory storage with Map indexing (Phase 2.5)',
  },
  avatarCodeSplit: {
    enabled: true,
    rolloutPercentage: 100,
    description: 'Code-split avatar bundle for faster initial load (Phase 4.5)',
  },
  optimizedStorage: {
    enabled: false,
    rolloutPercentage: 10,
    description: 'Reduced Chrome storage debounce from 400ms to 100ms (Phase 2.5)',
  },
  enhancedErrorBoundary: {
    enabled: false,
    rolloutPercentage: 0,
    description: 'Enhanced error boundary with better error recovery',
  },
  improvedCaching: {
    enabled: false,
    rolloutPercentage: 0,
    description: 'LRU cache for search results (Phase 2.5)',
  },
}

/**
 * Check if a feature is enabled for the current user
 *
 * @param flag - Feature flag to check
 * @param userId - Optional user ID for stable rollout percentage
 * @returns True if feature is enabled for this user
 *
 * @example
 * ```typescript
 * const userId = useSettingsStore(s => s.userId)
 * if (isFeatureEnabled('virtualScrolling', userId)) {
 *   // Use new feature
 * } else {
 *   // Use old implementation
 * }
 * ```
 */
export function isFeatureEnabled(flag: FeatureFlag, userId?: string): boolean {
  const config = FLAGS[flag]

  if (!config) {
    log.warn(`Unknown feature flag: ${flag}`)
    return false
  }

  if (!config.enabled) {
    return false
  }

  // Always enable for allow-listed users (for testing)
  if (userId && config.allowList?.includes(userId)) {
    log.log(`Feature '${flag}' enabled via allowList for user ${userId}`)
    return true
  }

  // Percentage-based rollout
  if (config.rolloutPercentage !== undefined) {
    const threshold = config.rolloutPercentage

    // If 100%, always enable
    if (threshold >= 100) {
      return true
    }

    // If 0%, always disable
    if (threshold <= 0) {
      return false
    }

    // Hash user ID for stable rollout (same user always gets same result)
    // If no userId, use random (session-based decision)
    const hash = userId ? hashUserId(userId) : Math.random() * 100

    return hash < threshold
  }

  // Default: enabled if config.enabled is true
  return true
}

/**
 * Get all feature flags and their current status
 *
 * Useful for debugging and admin panels
 *
 * @returns Object mapping flag names to their enabled status
 */
export function getAllFeatureFlags(): Record<FeatureFlag, boolean> {
  const result: Partial<Record<FeatureFlag, boolean>> = {}

  for (const flag in FLAGS) {
    result[flag as FeatureFlag] = FLAGS[flag as FeatureFlag].enabled
  }

  return result as Record<FeatureFlag, boolean>
}

/**
 * Get feature flag configuration (for admin/debug)
 *
 * @param flag - Feature flag to get config for
 * @returns Feature flag configuration
 */
export function getFeatureFlagConfig(flag: FeatureFlag): FeatureFlagConfig | undefined {
  return FLAGS[flag]
}

/**
 * Hash user ID to stable 0-100 value for consistent rollout
 *
 * Uses simple string hash algorithm to ensure:
 * - Same user ID always produces same hash
 * - Hash is evenly distributed across 0-100 range
 * - No external dependencies
 *
 * @param userId - User ID to hash
 * @returns Hash value between 0-99
 */
function hashUserId(userId: string): number {
  let hash = 0

  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }

  // Return value between 0-99
  return Math.abs(hash) % 100
}

/**
 * Hook for React components to check feature flags
 *
 * @param flag - Feature flag to check
 * @param userId - Optional user ID for stable rollout
 * @returns True if feature is enabled
 *
 * @example
 * ```typescript
 * function MessageList() {
 *   const userId = useSettingsStore(s => s.userId)
 *   const useVirtualScrolling = useFeatureFlag('virtualScrolling', userId)
 *
 *   if (useVirtualScrolling) {
 *     return <VirtualMessageList />
 *   }
 *   return <RegularMessageList />
 * }
 * ```
 */
export function useFeatureFlag(flag: FeatureFlag, userId?: string): boolean {
  // Note: This is not a React hook, but named 'use*' for convention
  // In actual React components, you'd use useMemo to prevent recalculation
  return isFeatureEnabled(flag, userId)
}
