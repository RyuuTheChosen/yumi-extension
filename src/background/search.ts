/**
 * Web Search Module
 *
 * Handles web search API calls through the Hub API.
 * Routes to SearXNG backend via Hub for real-time web results.
 */

import { createLogger } from '../lib/core/debug'
import { getErrorMessage } from '../lib/core/errors'
import { tryRefreshHubToken, getAccessToken, getRefreshToken, type HubConfig } from './auth'
import type { SettingsStateWithAuth } from '../types'
import type { SearchErrorType, SearchResult } from '../lib/search/types'

const log = createLogger('Search')

/** Persisted store structure (Zustand persist middleware wraps in 'state') */
interface PersistedStore<T> {
  state: T
  version: number
}

/** Search request payload from content script */
export interface SearchRequestPayload {
  query: string
  maxResults?: number
  searchDepth?: 'basic' | 'advanced'
}

/** Successful search response */
export interface SearchSuccessResponse {
  success: true
  query: string
  results: SearchResult[]
  responseTimeMs: number
}

/** Error search response */
export interface SearchErrorResponse {
  success: false
  error: string
  errorType: SearchErrorType
}

export type SearchResponse = SearchSuccessResponse | SearchErrorResponse

/** Request timeout in milliseconds */
const SEARCH_TIMEOUT_MS = 8000

/**
 * Get Hub settings from Chrome storage
 */
async function getHubSettings(): Promise<{
  hubUrl: string | null
  hubAccessToken: string | null
  hubRefreshToken: string | null
  settingsStore: PersistedStore<SettingsStateWithAuth> | null
}> {
  const data = await chrome.storage.local.get('settings-store')
  let settingsStore: PersistedStore<SettingsStateWithAuth> | null = null

  if (typeof data?.['settings-store'] === 'string') {
    settingsStore = JSON.parse(data['settings-store'])
  } else {
    settingsStore = data?.['settings-store'] || null
  }

  /** SECURITY: Get tokens from secure storage instead of settings store */
  return {
    hubUrl: settingsStore?.state?.hubUrl || null,
    hubAccessToken: await getAccessToken(),
    hubRefreshToken: await getRefreshToken(),
    settingsStore,
  }
}

/**
 * Execute search request to Hub API
 */
async function executeSearchRequest(
  hubUrl: string,
  hubAccessToken: string,
  payload: SearchRequestPayload,
  abortSignal: AbortSignal
): Promise<Response> {
  return fetch(`${hubUrl}/v1/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${hubAccessToken}`,
    },
    body: JSON.stringify({
      query: payload.query,
      max_results: payload.maxResults || 5,
      search_depth: payload.searchDepth || 'basic',
    }),
    signal: abortSignal,
  })
}

/**
 * Parse search response from Hub API
 */
async function parseSearchResponse(response: Response): Promise<{
  query: string
  results: SearchResult[]
  responseTimeMs: number
}> {
  const json = await response.json()
  return {
    query: json.query,
    results: json.results || [],
    responseTimeMs: json.response_time_ms || 0,
  }
}

/**
 * Determine error type from response status or error
 */
function getErrorType(status: number | null, error?: unknown): SearchErrorType {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'timeout'
  }
  if (error instanceof TypeError) {
    return 'network'
  }
  if (status === 401 || status === 403) {
    return 'auth'
  }
  if (status === 429) {
    return 'quota'
  }
  if (status === 503) {
    return 'config'
  }
  return 'unknown'
}

/**
 * Handle web search request
 *
 * Routes search through Hub API to SearXNG backend.
 * Handles authentication, token refresh, and structured error responses.
 *
 * @param payload - Search request payload
 * @returns Promise with search response
 */
export async function handleSearchRequest(
  payload: SearchRequestPayload
): Promise<SearchResponse> {
  const { query, maxResults = 5, searchDepth = 'basic' } = payload

  log.log(`[Search] Request: "${query.slice(0, 50)}${query.length > 50 ? '...' : ''}"`)

  const abortController = new AbortController()
  const timeoutId = setTimeout(() => abortController.abort(), SEARCH_TIMEOUT_MS)

  try {
    const { hubUrl, hubAccessToken, hubRefreshToken, settingsStore } = await getHubSettings()

    if (!hubAccessToken || !hubUrl) {
      clearTimeout(timeoutId)
      return {
        success: false,
        error: 'Hub not connected',
        errorType: 'auth',
      }
    }

    const response = await executeSearchRequest(
      hubUrl,
      hubAccessToken,
      { query, maxResults, searchDepth },
      abortController.signal
    )

    if (response.status === 401) {
      log.log('[Search] Token expired, attempting refresh')
      const refreshed = await tryRefreshHubToken({
        hubUrl,
        hubAccessToken,
        hubRefreshToken: hubRefreshToken || null,
        settingsStore,
      } as HubConfig)

      if (refreshed) {
        const { hubAccessToken: newToken } = await getHubSettings()
        if (newToken) {
          const retryResponse = await executeSearchRequest(
            hubUrl,
            newToken,
            { query, maxResults, searchDepth },
            abortController.signal
          )

          if (!retryResponse.ok) {
            const errText = await retryResponse.text().catch(() => 'Unknown error')
            clearTimeout(timeoutId)
            return {
              success: false,
              error: `Search failed: ${errText}`,
              errorType: getErrorType(retryResponse.status),
            }
          }

          const data = await parseSearchResponse(retryResponse)
          clearTimeout(timeoutId)
          log.log(`[Search] Complete (after refresh): ${data.results.length} results in ${data.responseTimeMs}ms`)
          return {
            success: true,
            query: data.query,
            results: data.results,
            responseTimeMs: data.responseTimeMs,
          }
        }
      }

      clearTimeout(timeoutId)
      return {
        success: false,
        error: 'Session expired. Please log in again.',
        errorType: 'auth',
      }
    }

    if (response.status === 429) {
      clearTimeout(timeoutId)
      return {
        success: false,
        error: 'Search quota exceeded',
        errorType: 'quota',
      }
    }

    if (response.status === 503) {
      clearTimeout(timeoutId)
      return {
        success: false,
        error: 'Search service not configured',
        errorType: 'config',
      }
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error')
      clearTimeout(timeoutId)
      return {
        success: false,
        error: `Search failed: ${errText}`,
        errorType: getErrorType(response.status),
      }
    }

    const data = await parseSearchResponse(response)
    clearTimeout(timeoutId)
    log.log(`[Search] Complete: ${data.results.length} results in ${data.responseTimeMs}ms`)

    return {
      success: true,
      query: data.query,
      results: data.results,
      responseTimeMs: data.responseTimeMs,
    }

  } catch (err) {
    clearTimeout(timeoutId)
    const errorType = getErrorType(null, err)
    const errorMessage = errorType === 'timeout'
      ? 'Search timed out'
      : errorType === 'network'
        ? 'Could not connect to search service'
        : getErrorMessage(err, 'Unknown error')

    log.error(`[Search] Error (${errorType}):`, err)

    return {
      success: false,
      error: errorMessage,
      errorType,
    }
  }
}
