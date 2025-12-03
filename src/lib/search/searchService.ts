/**
 * Yumi Web Search Service
 *
 * Handles web search requests via the Hub API.
 * Includes in-memory caching for repeated queries.
 */

import type {
  SearchRequest,
  SearchResponse,
  SearchResult,
  CachedSearch,
} from './types'
import { SEARCH_CONFIG } from './types'

// In-memory search cache
const searchCache = new Map<string, CachedSearch>()

/**
 * Normalize query for cache key (lowercase, trimmed).
 */
function getCacheKey(query: string): string {
  return query.toLowerCase().trim()
}

/**
 * Clean up expired cache entries.
 */
function cleanExpiredCache(): void {
  const now = Date.now()
  for (const [key, cached] of searchCache.entries()) {
    if (cached.expiresAt < now) {
      searchCache.delete(key)
    }
  }

  // If still over limit, remove oldest entries
  if (searchCache.size > SEARCH_CONFIG.maxCacheSize) {
    const entries = Array.from(searchCache.entries())
      .sort((a, b) => a[1].cachedAt - b[1].cachedAt)

    const toRemove = entries.slice(0, entries.length - SEARCH_CONFIG.maxCacheSize)
    for (const [key] of toRemove) {
      searchCache.delete(key)
    }
  }
}

/**
 * Get cached search result if available and not expired.
 */
function getCachedSearch(query: string): SearchResponse | null {
  const key = getCacheKey(query)
  const cached = searchCache.get(key)

  if (!cached) return null
  if (cached.expiresAt < Date.now()) {
    searchCache.delete(key)
    return null
  }

  return cached.response
}

/**
 * Cache a search response.
 */
function cacheSearch(query: string, response: SearchResponse): void {
  cleanExpiredCache()

  const now = Date.now()
  const key = getCacheKey(query)

  searchCache.set(key, {
    response,
    cachedAt: now,
    expiresAt: now + SEARCH_CONFIG.cacheTtlMs,
  })
}

/**
 * Perform a web search via the Hub API.
 * Returns cached result if available.
 */
export async function performSearch(
  request: SearchRequest
): Promise<SearchResponse> {
  const { query, maxResults = SEARCH_CONFIG.defaultMaxResults, searchDepth = 'basic' } = request

  // Check cache first
  const cached = getCachedSearch(query)
  if (cached) {
    return cached
  }

  // Send message to background worker to perform the search
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Search request timed out'))
    }, SEARCH_CONFIG.timeoutMs + 1000) // Extra buffer for message passing

    chrome.runtime.sendMessage(
      {
        type: 'SEARCH_REQUEST',
        payload: { query, maxResults, searchDepth },
      },
      (response) => {
        clearTimeout(timeoutId)

        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }

        if (!response?.success) {
          reject(new Error(response?.error || 'Search failed'))
          return
        }

        const searchResponse: SearchResponse = {
          query: response.query,
          results: response.results,
          responseTimeMs: response.responseTimeMs,
        }

        // Cache the successful response
        cacheSearch(query, searchResponse)

        resolve(searchResponse)
      }
    )
  })
}

/**
 * Format search results for inclusion in system prompt.
 */
export function formatSearchResultsForPrompt(results: SearchResult[]): string {
  if (!results || results.length === 0) {
    return 'Web search returned no results.'
  }

  const formatted = results
    .map((result, index) => {
      const date = result.publishedDate
        ? ` (${result.publishedDate})`
        : ''
      return `### ${index + 1}. ${result.title}${date}
Source: ${result.url}
${result.content}`
    })
    .join('\n\n')

  return `## Web Search Results

You searched the web and found:

${formatted}

Guidelines:
- Cite sources naturally ("According to [source]...")
- Synthesize multiple sources when relevant
- Acknowledge when information might be outdated`
}

/**
 * Clear the search cache.
 */
export function clearSearchCache(): void {
  searchCache.clear()
}

/**
 * Get current cache size.
 */
export function getSearchCacheSize(): number {
  cleanExpiredCache()
  return searchCache.size
}
