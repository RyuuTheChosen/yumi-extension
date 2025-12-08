export interface SearchResult {
  title: string
  url: string
  content: string
  score: number
  publishedDate?: string
}

export interface SearchRequest {
  query: string
  maxResults?: number
  searchDepth?: 'basic' | 'advanced'
}

export interface SearchResponse {
  query: string
  results: SearchResult[]
  responseTimeMs: number
}

export interface CachedSearch {
  response: SearchResponse
  cachedAt: number
  expiresAt: number
}

/** Search error types for UI-specific messaging */
export type SearchErrorType = 'timeout' | 'network' | 'auth' | 'quota' | 'config' | 'unknown'

/** Search error with type for error handling */
export interface SearchError extends Error {
  errorType: SearchErrorType
}

export const SEARCH_CONFIG = {
  timeoutMs: 5000,
  cacheTtlMs: 5 * 60 * 1000,
  maxCacheSize: 20,
  defaultMaxResults: 5,
}
