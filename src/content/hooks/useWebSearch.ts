/**
 * Web Search Hook
 *
 * Manages web search integration for chat messages.
 * Provides simple API for performing searches and associating results with messages.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { createLogger } from '../../lib/core/debug'
import {
  extractSearchQuery,
  performSearch,
  type SearchResult,
  type SearchErrorType,
} from '../../lib/search'

const log = createLogger('useWebSearch')

/** Search error with type for specific UI messaging */
export interface SearchError {
  message: string
  type: SearchErrorType
}

export interface UseWebSearchOptions {
  status: 'idle' | 'sending' | 'streaming' | 'error' | 'canceled'
  displayMessages: Array<{ role: string; id: string }>
}

export interface UseWebSearchReturn {
  isSearching: boolean
  searchError: SearchError | null
  messageSources: Map<string, SearchResult[]>
  lastSearchQuery: string | null
  pendingSourcesRef: React.MutableRefObject<SearchResult[] | null>
  performSearchForMessage: (message: string) => Promise<SearchResult[] | null>
  clearError: () => void
  retrySearch: () => Promise<SearchResult[] | null>
  setMessageSources: React.Dispatch<React.SetStateAction<Map<string, SearchResult[]>>>
}

/** Error messages by type */
const ERROR_MESSAGES: Record<SearchErrorType, string> = {
  timeout: 'Search timed out',
  network: 'Could not connect to search',
  auth: 'Search requires login',
  quota: 'Search quota exceeded',
  config: 'Search not configured',
  unknown: 'Search failed',
}

/**
 * Custom hook for web search integration
 *
 * Features:
 * - Performs web search and returns results
 * - Associates search results with assistant messages
 * - Handles search errors with specific messages
 * - Supports retry functionality
 */
export function useWebSearch(options: UseWebSearchOptions): UseWebSearchReturn {
  const { status, displayMessages } = options

  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<SearchError | null>(null)
  const [lastSearchQuery, setLastSearchQuery] = useState<string | null>(null)
  const [messageSources, setMessageSources] = useState<Map<string, SearchResult[]>>(new Map())
  const pendingSourcesRef = useRef<SearchResult[] | null>(null)

  /**
   * Associate search results with assistant messages after streaming completes
   */
  useEffect(() => {
    if (status === 'idle' && pendingSourcesRef.current && displayMessages.length > 0) {
      const lastMessage = displayMessages[displayMessages.length - 1]
      if (lastMessage.role === 'assistant' && lastMessage.id) {
        log.log('[useWebSearch] Associating sources with message:', lastMessage.id)
        setMessageSources(prev => {
          const next = new Map(prev)
          next.set(lastMessage.id, pendingSourcesRef.current!)
          return next
        })
        pendingSourcesRef.current = null
      }
    }
  }, [status, displayMessages])

  /**
   * Perform search for a message
   */
  const performSearchForMessage = useCallback(async (message: string): Promise<SearchResult[] | null> => {
    const query = extractSearchQuery(message)
    setLastSearchQuery(query)
    setIsSearching(true)
    setSearchError(null)

    try {
      log.log('[useWebSearch] Performing search for:', query)
      const response = await performSearch({ query })
      log.log('[useWebSearch] Search completed:', response.results.length, 'results')
      return response.results
    } catch (err) {
      log.warn('[useWebSearch] Search failed:', err)

      const errorType = (err as { errorType?: SearchErrorType })?.errorType || 'unknown'
      setSearchError({
        message: ERROR_MESSAGES[errorType],
        type: errorType,
      })
      return null
    } finally {
      setIsSearching(false)
    }
  }, [])

  /**
   * Clear search error
   */
  const clearError = useCallback(() => {
    setSearchError(null)
  }, [])

  /**
   * Retry last search
   */
  const retrySearch = useCallback(async (): Promise<SearchResult[] | null> => {
    if (!lastSearchQuery) return null

    setIsSearching(true)
    setSearchError(null)

    try {
      log.log('[useWebSearch] Retrying search for:', lastSearchQuery)
      const response = await performSearch({ query: lastSearchQuery })
      log.log('[useWebSearch] Retry completed:', response.results.length, 'results')
      return response.results
    } catch (err) {
      log.warn('[useWebSearch] Retry failed:', err)

      const errorType = (err as { errorType?: SearchErrorType })?.errorType || 'unknown'
      setSearchError({
        message: ERROR_MESSAGES[errorType],
        type: errorType,
      })
      return null
    } finally {
      setIsSearching(false)
    }
  }, [lastSearchQuery])

  return {
    isSearching,
    searchError,
    messageSources,
    lastSearchQuery,
    pendingSourcesRef,
    performSearchForMessage,
    clearError,
    retrySearch,
    setMessageSources,
  }
}
