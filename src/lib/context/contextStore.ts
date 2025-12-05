/**
 * Context Store - Zustand State Management
 *
 * Manages page context with caching and automatic invalidation.
 */

import { create } from 'zustand'
import { createLogger } from '../debug'

const log = createLogger('ContextStore')
import type {
  PageContext,
  ContextState,
  ExtractionOptions,
  ContextPrivacySettings,
} from './types'
import {
  DEFAULT_EXTRACTION_OPTIONS,
  DEFAULT_PRIVACY_SETTINGS,
  CACHE_CONFIG,
} from './types'
import { extractPageContext } from './extraction'

/**
 * LRU Cache for page contexts
 */
interface CacheEntry {
  context: PageContext
  expiresAt: number
}

const contextCache = new Map<string, CacheEntry>()

/**
 * Evict oldest entries when cache is full
 */
function evictOldestEntries(): void {
  if (contextCache.size <= CACHE_CONFIG.maxCachedUrls) return

  // Sort by expiry time, remove oldest
  const entries = Array.from(contextCache.entries())
    .sort((a, b) => a[1].expiresAt - b[1].expiresAt)

  const toRemove = entries.slice(0, entries.length - CACHE_CONFIG.maxCachedUrls + 1)
  for (const [key] of toRemove) {
    contextCache.delete(key)
  }
}

/**
 * Get cached context if valid
 */
function getCached(url: string): PageContext | null {
  const entry = contextCache.get(url)
  if (!entry) return null

  if (Date.now() > entry.expiresAt) {
    contextCache.delete(url)
    return null
  }

  return entry.context
}

/**
 * Cache a context
 */
function setCache(url: string, context: PageContext): void {
  evictOldestEntries()
  contextCache.set(url, {
    context,
    expiresAt: Date.now() + CACHE_CONFIG.contextMaxAge,
  })
}

/**
 * Context Store
 */
export const useContextStore = create<ContextState>((set, get) => ({
  // State
  currentContext: null,
  isExtracting: false,
  lastError: null,

  // Settings
  autoExtractLevel: 1,  // Default to lightweight extraction
  privacySettings: DEFAULT_PRIVACY_SETTINGS,

  // Extract page context
  extract: async (options?: Partial<ExtractionOptions>): Promise<PageContext> => {
    const state = get()
    const url = window.location.href

    // Check privacy settings
    if (!state.privacySettings.enabled) {
      const minimalContext: PageContext = {
        url,
        origin: window.location.origin,
        pathname: window.location.pathname,
        title: document.title,
        type: 'other',
        metadata: { title: document.title },
        confidence: 0,
        extractedAt: Date.now(),
        extractionLevel: 0,
      }
      set({ currentContext: minimalContext })
      return minimalContext
    }

    // Check cache first
    const cached = getCached(url)
    const requestedLevel = options?.level ?? DEFAULT_EXTRACTION_OPTIONS.level
    if (cached && cached.extractionLevel >= requestedLevel) {
      set({ currentContext: cached })
      return cached
    }

    // Extract new context
    set({ isExtracting: true, lastError: null })

    try {
      const context = await extractPageContext({
        ...DEFAULT_EXTRACTION_OPTIONS,
        ...options,
      })

      setCache(url, context)
      set({ currentContext: context, isExtracting: false })
      return context
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      log.error('Extraction failed:', error)
      set({ isExtracting: false, lastError: errorMessage })
      throw error
    }
  },

  // Get current context (synchronous)
  getContext: (): PageContext | null => {
    return get().currentContext
  },

  // Clear all cache
  clearCache: (): void => {
    contextCache.clear()
    set({ currentContext: null })
    log.log('Cache cleared')
  },

  // Invalidate specific URL
  invalidateUrl: (url: string): void => {
    contextCache.delete(url)
    if (get().currentContext?.url === url) {
      set({ currentContext: null })
    }
    log.log('Invalidated:', url)
  },

  // Set auto-extract level
  setAutoExtractLevel: (level: 0 | 1 | 2): void => {
    set({ autoExtractLevel: level })
    log.log('Auto-extract level set to:', level)
  },

  // Update privacy settings
  updatePrivacySettings: (settings: Partial<ContextPrivacySettings>): void => {
    set(state => ({
      privacySettings: { ...state.privacySettings, ...settings },
    }))
    log.log('Privacy settings updated')
  },
}))

/**
 * Auto-extract context on navigation (call from content script)
 */
export async function autoExtractOnNavigation(): Promise<void> {
  const state = useContextStore.getState()

  if (!state.privacySettings.enabled) return
  if (state.autoExtractLevel === 0) return

  try {
    await state.extract({ level: state.autoExtractLevel })
  } catch (error) {
    log.warn('Auto-extraction failed:', error)
  }
}

/**
 * Subscribe to URL changes and auto-extract
 */
let lastUrl = ''

export function setupNavigationListener(): () => void {
  const checkNavigation = () => {
    const currentUrl = window.location.href
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl
      autoExtractOnNavigation()
    }
  }

  // Check periodically for SPA navigation
  const interval = setInterval(checkNavigation, 1000)

  // Also listen for popstate (back/forward navigation)
  window.addEventListener('popstate', checkNavigation)

  // Return cleanup function
  return () => {
    clearInterval(interval)
    window.removeEventListener('popstate', checkNavigation)
  }
}

/**
 * Get context for current page (convenience function)
 */
export async function getCurrentContext(level: 0 | 1 | 2 | 3 = 2): Promise<PageContext> {
  return useContextStore.getState().extract({ level })
}

/**
 * Check if context is stale
 */
export function isContextStale(context: PageContext | null, maxAgeMs: number = CACHE_CONFIG.contextMaxAge): boolean {
  if (!context) return true
  return Date.now() - context.extractedAt > maxAgeMs
}
