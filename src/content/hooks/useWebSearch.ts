/**
 * Web Search Hook
 *
 * Manages web search integration for chat messages.
 * Detects search intent, prompts user for confirmation, and performs searches.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { createLogger } from '../../lib/debug'
import {
  shouldSuggestSearch,
  extractSearchQuery,
  performSearch,
  type SearchResult,
} from '../../lib/search'

const log = createLogger('useWebSearch')

export interface UseWebSearchOptions {
  status: 'idle' | 'sending' | 'streaming' | 'error' | 'canceled'
  displayMessages: Array<{ role: string; id: string }>
  statusRef: React.MutableRefObject<string>
}

export interface UseWebSearchReturn {
  showSearchPrompt: boolean
  isSearching: boolean
  searchError: string | null
  searchQuery: string
  messageSources: Map<string, SearchResult[]>
  pendingSourcesRef: React.MutableRefObject<SearchResult[] | null>
  handleSendMessage: (content: string, doSendMessage: (content: string, searchResults?: SearchResult[]) => Promise<void>) => Promise<void>
  handleSearchConfirm: (doSendMessage: (content: string, searchResults?: SearchResult[]) => Promise<void>) => Promise<void>
  handleSearchSkip: (doSendMessage: (content: string) => Promise<void>) => Promise<void>
  setMessageSources: React.Dispatch<React.SetStateAction<Map<string, SearchResult[]>>>
}

/**
 * Custom hook for web search integration
 *
 * Features:
 * - Detects search intent in user messages
 * - Shows search confirmation prompt
 * - Performs web search and attaches results to messages
 * - Associates search results with assistant responses
 * - Handles search errors gracefully
 */
export function useWebSearch(options: UseWebSearchOptions): UseWebSearchReturn {
  const { status, displayMessages, statusRef } = options

  const [showSearchPrompt, setShowSearchPrompt] = useState(false)
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
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
   * Handle search confirmation - perform search and send message with results
   */
  const handleSearchConfirm = useCallback(async (doSendMessage: (content: string, searchResults?: SearchResult[]) => Promise<void>) => {
    if (!pendingMessage) return

    setShowSearchPrompt(false)
    setIsSearching(true)
    setSearchError(null)

    try {
      log.log('[useWebSearch] Performing web search for:', searchQuery)
      const response = await performSearch({ query: searchQuery })
      log.log('[useWebSearch] Search completed:', response.results.length, 'results')
      await doSendMessage(pendingMessage, response.results)
    } catch (err) {
      log.warn('[useWebSearch] Search failed, sending without results:', err)
      setSearchError('Search unavailable, answering from knowledge')
      setTimeout(() => setSearchError(null), 4000)
      await doSendMessage(pendingMessage)
    } finally {
      setIsSearching(false)
      setPendingMessage(null)
      setSearchQuery('')
    }
  }, [pendingMessage, searchQuery])

  /**
   * Handle search skip - send message without search results
   */
  const handleSearchSkip = useCallback(async (doSendMessage: (content: string) => Promise<void>) => {
    if (!pendingMessage) return

    setShowSearchPrompt(false)
    setPendingMessage(null)
    setSearchQuery('')

    await doSendMessage(pendingMessage)
  }, [pendingMessage])

  /**
   * Main send message handler - checks if search should be suggested
   */
  const handleSendMessage = useCallback(async (
    content: string,
    doSendMessage: (content: string, searchResults?: SearchResult[]) => Promise<void>
  ) => {
    if (!content.trim() || statusRef.current === 'sending' || statusRef.current === 'streaming') return

    if (shouldSuggestSearch(content)) {
      const query = extractSearchQuery(content)
      log.log('[useWebSearch] Search suggested for:', query)
      setSearchQuery(query)
      setPendingMessage(content)
      setShowSearchPrompt(true)
      return
    }

    await doSendMessage(content)
  }, [statusRef])

  return {
    showSearchPrompt,
    isSearching,
    searchError,
    searchQuery,
    messageSources,
    pendingSourcesRef,
    handleSendMessage,
    handleSearchConfirm,
    handleSearchSkip,
    setMessageSources
  }
}
