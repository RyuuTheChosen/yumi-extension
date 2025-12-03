/**
 * Yumi Web Search - Type Definitions
 *
 * Types for the web search feature that allows Yumi to look up
 * current information from the web.
 */

/**
 * A single search result from the web.
 */
export interface SearchResult {
  /** Title of the search result */
  title: string
  /** URL of the source */
  url: string
  /** Content snippet from the page */
  content: string
  /** Relevance score (0-1) */
  score: number
  /** Published date if available */
  publishedDate?: string
}

/**
 * Request to perform a web search.
 */
export interface SearchRequest {
  /** Search query (1-400 chars) */
  query: string
  /** Maximum results to return (1-10, default 5) */
  maxResults?: number
  /** Search depth - basic or advanced */
  searchDepth?: 'basic' | 'advanced'
}

/**
 * Response from a web search.
 */
export interface SearchResponse {
  /** Original query */
  query: string
  /** Search results */
  results: SearchResult[]
  /** Response time in milliseconds */
  responseTimeMs: number
}

/**
 * Cached search result with expiration.
 */
export interface CachedSearch {
  /** The search response */
  response: SearchResponse
  /** When this was cached (timestamp) */
  cachedAt: number
  /** When this expires (timestamp) */
  expiresAt: number
}

/**
 * Search configuration constants.
 */
export const SEARCH_CONFIG = {
  /** Search timeout in milliseconds */
  timeoutMs: 5000,

  /** Cache TTL in milliseconds (5 minutes) */
  cacheTtlMs: 5 * 60 * 1000,

  /** Maximum cached queries */
  maxCacheSize: 20,

  /** Default number of results */
  defaultMaxResults: 5,

  /** Auto-dismiss prompt after this many ms */
  promptDismissMs: 10000,
}
