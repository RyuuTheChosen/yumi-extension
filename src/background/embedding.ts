/**
 * Embedding Generation Background Handler
 *
 * Handles embedding generation API calls via Hub API.
 * Routes through the background script to avoid CORS issues.
 */

import { createLogger } from '../lib/core/debug'
import { MODELS } from '../lib/config/constants'
import { getErrorMessage, redactSensitive } from '../lib/core/errors'
import { tryRefreshHubToken, getAccessToken, getRefreshToken, type HubConfig } from './auth'
import type { SettingsStateWithAuth } from '../types'
import { EMBEDDING_CONFIG } from '../lib/memory/types'

const log = createLogger('Embedding')

/**
 * Persisted store structure (Zustand persist middleware wraps in 'state')
 */
interface PersistedStore<T> {
  state: T
  version: number
}

/**
 * Embedding request payload
 */
export interface EmbeddingPayload {
  texts: string[]
  memoryIds?: string[]
}

/**
 * Embedding response
 */
export interface EmbeddingResponse {
  success: boolean
  embeddings?: number[][]
  model?: string
  error?: string
}

/**
 * Handle embedding generation request
 *
 * Batch API call for generating embeddings via Hub API.
 * Routes through Hub API with quota exemption header.
 *
 * @param payload - Embedding payload with texts to embed
 * @returns Promise with embedding response
 */
export async function handleEmbeddingGeneration(
  payload: EmbeddingPayload
): Promise<EmbeddingResponse> {
  const { texts } = payload

  if (texts.length === 0) {
    return { success: true, embeddings: [], model: EMBEDDING_CONFIG.modelVersion }
  }

  log.log(`[Embedding] Generation request for ${texts.length} texts`)

  try {
    const data = await chrome.storage.local.get('settings-store')
    let settingsStore: PersistedStore<SettingsStateWithAuth>
    if (typeof data?.['settings-store'] === 'string') {
      settingsStore = JSON.parse(data['settings-store'])
    } else {
      settingsStore = data?.['settings-store']
    }

    const hubUrl = settingsStore?.state?.hubUrl
    /** SECURITY: Get tokens from secure storage instead of settings store */
    const hubAccessToken = await getAccessToken()
    const hubRefreshToken = await getRefreshToken()

    if (!hubAccessToken || !hubUrl) {
      return { success: false, error: 'Hub not connected' }
    }

    log.log('[Embedding] Generation via Hub API')

    const response = await fetch(`${hubUrl}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${hubAccessToken}`,
        'X-Yumi-Request-Type': 'memory-embedding',
      },
      body: JSON.stringify({
        input: texts,
        model: MODELS.EMBEDDING,
      }),
    })

    /** Handle 401 - token might be expired */
    if (response.status === 401) {
      log.log('[Embedding] Hub token expired, attempting refresh')
      const refreshed = await tryRefreshHubToken({
        hubUrl,
        hubAccessToken,
        hubRefreshToken: hubRefreshToken || null,
        settingsStore
      } as HubConfig)

      if (refreshed) {
        const newData = await chrome.storage.local.get('settings-store')
        let newSettingsStore: PersistedStore<SettingsStateWithAuth>
        if (typeof newData?.['settings-store'] === 'string') {
          newSettingsStore = JSON.parse(newData['settings-store'])
        } else {
          newSettingsStore = newData?.['settings-store']
        }

        const retryResponse = await fetch(`${hubUrl}/v1/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${newSettingsStore?.state?.hubAccessToken}`,
            'X-Yumi-Request-Type': 'memory-embedding',
          },
          body: JSON.stringify({
            input: texts,
            model: MODELS.EMBEDDING,
          }),
        })

        if (!retryResponse.ok) {
          const errText = await retryResponse.text().catch(() => 'Unknown error')
          return { success: false, error: `API error ${retryResponse.status}: ${errText}` }
        }

        const json = await retryResponse.json()
        const embeddings = json.data?.map((d: { embedding: number[] }) => d.embedding)

        if (!embeddings || !Array.isArray(embeddings)) {
          return { success: false, error: 'Invalid embedding response format' }
        }

        log.log(`[Embedding] Generation complete (after refresh), ${embeddings.length} embeddings`)
        return { success: true, embeddings, model: EMBEDDING_CONFIG.modelVersion }
      } else {
        return { success: false, error: 'Hub session expired. Please log in again.' }
      }
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error')
      return { success: false, error: `API error ${response.status}: ${errText}` }
    }

    const json = await response.json()
    const embeddings = json.data?.map((d: { embedding: number[] }) => d.embedding)

    if (!embeddings || !Array.isArray(embeddings)) {
      return { success: false, error: 'Invalid embedding response format' }
    }

    log.log(`[Embedding] Generation complete, ${embeddings.length} embeddings`)

    return { success: true, embeddings, model: EMBEDDING_CONFIG.modelVersion }

  } catch (err) {
    log.error('[Embedding] Generation error:', redactSensitive(err))
    return { success: false, error: getErrorMessage(err, 'Unknown error') }
  }
}
