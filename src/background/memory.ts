/**
 * Memory Extraction Module
 *
 * Handles memory extraction API calls to extract memories from conversations.
 * Routes through Hub API with quota exemption for memory operations.
 */

import { createLogger } from '../lib/core/debug'
import { MODELS, API, SAMPLING } from '../lib/config/constants'
import { getErrorMessage, redactSensitive } from '../lib/core/errors'
import { tryRefreshHubToken, getAccessToken, getRefreshToken, type HubConfig } from './auth'
import type { SettingsStateWithAuth } from '../types'

const log = createLogger('Memory')

/**
 * Persisted store structure (Zustand persist middleware wraps in 'state')
 */
interface PersistedStore<T> {
  state: T
  version: number
}

/**
 * Memory extraction request payload
 */
export interface MemoryExtractionPayload {
  requestId: string
  systemPrompt: string
  userPrompt: string
}

/**
 * Memory extraction response
 */
export interface MemoryExtractionResponse {
  success: boolean
  raw?: string
  error?: string
}

/**
 * Handle memory extraction request
 *
 * Non-streaming API call for extracting memories from conversations.
 * Routes through Hub API with quota exemption header.
 *
 * @param payload - Memory extraction payload with prompts
 * @returns Promise with extraction response
 */
export async function handleMemoryExtraction(
  payload: MemoryExtractionPayload
): Promise<MemoryExtractionResponse> {
  const { requestId, systemPrompt, userPrompt } = payload

  log.log(`[Memory] Extraction request: ${requestId}`)

  try {
    // Get Hub settings
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

    log.log('[Memory] Extraction via Hub API')

    const response = await fetch(`${hubUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${hubAccessToken}`,
        'X-Yumi-Request-Type': 'memory-extraction', // Exempt from quota
      },
      body: JSON.stringify({
        model: MODELS.MEMORY_EXTRACTION,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: false,
        temperature: SAMPLING.MEMORY_EXTRACTION_TEMPERATURE,
        max_tokens: API.MEMORY_EXTRACTION_MAX_TOKENS,
      }),
    })

    // Handle 401 - token might be expired
    if (response.status === 401) {
      log.log('[Memory] Hub token expired, attempting refresh')
      const refreshed = await tryRefreshHubToken({
        hubUrl,
        hubAccessToken,
        hubRefreshToken: hubRefreshToken || null,
        settingsStore
      } as HubConfig)

      if (refreshed) {
        // Get new token and retry
        const newData = await chrome.storage.local.get('settings-store')
        let newSettingsStore: PersistedStore<SettingsStateWithAuth>
        if (typeof newData?.['settings-store'] === 'string') {
          newSettingsStore = JSON.parse(newData['settings-store'])
        } else {
          newSettingsStore = newData?.['settings-store']
        }

        const retryResponse = await fetch(`${hubUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${newSettingsStore?.state?.hubAccessToken}`,
            'X-Yumi-Request-Type': 'memory-extraction',
          },
          body: JSON.stringify({
            model: MODELS.MEMORY_EXTRACTION,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            stream: false,
            temperature: SAMPLING.MEMORY_EXTRACTION_TEMPERATURE,
            max_tokens: API.MEMORY_EXTRACTION_MAX_TOKENS,
          }),
        })

        if (!retryResponse.ok) {
          const errText = await retryResponse.text().catch(() => 'Unknown error')
          return { success: false, error: `API error ${retryResponse.status}: ${errText}` }
        }

        const json = await retryResponse.json()
        const content = json.choices?.[0]?.message?.content || ''
        log.log(`[Memory] Extraction complete (after refresh), response length: ${content.length}`)
        return { success: true, raw: content }
      } else {
        return { success: false, error: 'Hub session expired. Please log in again.' }
      }
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error')
      return { success: false, error: `API error ${response.status}: ${errText}` }
    }

    const json = await response.json()
    const content = json.choices?.[0]?.message?.content || ''

    log.log(`[Memory] Extraction complete, response length: ${content.length}`)

    return { success: true, raw: content }

  } catch (err) {
    log.error('[Memory] Extraction error:', redactSensitive(err))
    return { success: false, error: getErrorMessage(err, 'Unknown error') }
  }
}
