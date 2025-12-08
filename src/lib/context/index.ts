/**
 * Yumi Context Awareness System
 *
 * Enables Yumi to understand what the user is looking at and provide
 * intelligent, contextual assistance.
 *
 * Usage:
 * ```typescript
 * import { useContextStore, getCurrentContext } from '@/lib/context'
 *
 * // Get current page context
 * const context = await getCurrentContext()
 *
 * // Or use the store
 * const { currentContext, extract } = useContextStore.getState()
 * await extract({ level: 2 })
 * ```
 */

// Types
export type {
  PageType,
  PageMetadata,
  PageStructure,
  PageContext,
  SiteSpecificData,
  ExtractionOptions,
  ContextPrivacySettings,
  ContextState,
  DetectionSignal,
} from './types'

export {
  DEFAULT_EXTRACTION_OPTIONS,
  CONTENT_LIMITS,
  CACHE_CONFIG,
  DEFAULT_PRIVACY_SETTINGS,
} from './types'

// Extraction
export {
  extractPageContext,
  detectPageType,
  redactSensitiveContent,
  buildContextForPrompt,
} from './extraction'

// Store
export {
  useContextStore,
  autoExtractOnNavigation,
  setupNavigationListener,
  getCurrentContext,
  isContextStale,
} from './context.store'
