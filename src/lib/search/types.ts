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

export const SEARCH_CONFIG = {
  timeoutMs: 5000,
  cacheTtlMs: 5 * 60 * 1000,
  maxCacheSize: 20,
  defaultMaxResults: 5,
  promptDismissMs: 10000,
}
