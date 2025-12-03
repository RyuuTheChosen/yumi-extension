import type {
  SearchRequest,
  SearchResponse,
  SearchResult,
  CachedSearch,
} from './types'
import { SEARCH_CONFIG } from './types'

const searchCache = new Map<string, CachedSearch>()

function getCacheKey(query: string): string {
  return query.toLowerCase().trim()
}

function cleanExpiredCache(): void {
  const now = Date.now()
  for (const [key, cached] of searchCache.entries()) {
    if (cached.expiresAt < now) {
      searchCache.delete(key)
    }
  }

  if (searchCache.size > SEARCH_CONFIG.maxCacheSize) {
    const entries = Array.from(searchCache.entries())
      .sort((a, b) => a[1].cachedAt - b[1].cachedAt)

    const toRemove = entries.slice(0, entries.length - SEARCH_CONFIG.maxCacheSize)
    for (const [key] of toRemove) {
      searchCache.delete(key)
    }
  }
}

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

export async function performSearch(
  request: SearchRequest
): Promise<SearchResponse> {
  const { query, maxResults = SEARCH_CONFIG.defaultMaxResults, searchDepth = 'basic' } = request

  const cached = getCachedSearch(query)
  if (cached) {
    return cached
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Search request timed out'))
    }, SEARCH_CONFIG.timeoutMs + 1000)

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

        cacheSearch(query, searchResponse)

        resolve(searchResponse)
      }
    )
  })
}

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

export function clearSearchCache(): void {
  searchCache.clear()
}

export function getSearchCacheSize(): number {
  cleanExpiredCache()
  return searchCache.size
}
