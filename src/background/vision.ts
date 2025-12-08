/**
 * Vision Query Module
 *
 * Handles vision queries with image analysis capabilities.
 * Routes all queries through Hub API with automatic token refresh.
 */

import { createLogger } from '../lib/core/debug'
import { buildSingleStageVisionPrompt, VISION_UX_MESSAGES } from '../lib/prompts/vision'
import { API, SAMPLING, MODELS } from '../lib/config/constants'
import { getErrorMessage } from '../lib/core/errors'
import { tryRefreshHubToken, type HubConfig } from './auth'
import type {
  VisionQueryPayload,
  Message,
  SettingsStateWithAuth,
  PersonalityState,
  Personality,
} from '../types'

const log = createLogger('Vision')

/**
 * Persisted store structure (Zustand persist middleware wraps in 'state')
 */
interface PersistedStore<T> {
  state: T
  version: number
}

/**
 * Active abort controllers for cancellation
 */
export const activeVisionControllers = new Map<string, AbortController>()

/**
 * Extended vision query payload with additional context
 */
export interface ExtendedVisionQueryPayload extends VisionQueryPayload {
  prompt?: string
  history?: Message[]
  imageContext?: { pageTitle?: string; domain?: string }
}

/**
 * Vision Query Handler - Hub Only
 *
 * Routes all vision queries through the Hub API.
 * Hub handles provider selection and API key management.
 *
 * @param port - Chrome runtime port for streaming responses
 * @param payload - Vision query payload with image and context
 */
export async function handleVisionQuery(
  port: chrome.runtime.Port,
  payload: ExtendedVisionQueryPayload
): Promise<void> {
  const startTime = Date.now()
  const { requestId, source, prompt, imageBase64, scopeId, history, imageContext } = payload

  log.log(`[Vision] Query from ${source}`, {
    requestId,
    hasImage: !!imageBase64,
    scopeId,
    historyLength: history?.length || 0
  })

  // Helper to send stage indicator to floating bubble
  const sendStageIndicator = (stage: 'analyzing' | 'thinking' | 'error' | 'timeout') => {
    port.postMessage({
      type: 'VISION_STAGE',
      payload: { stage, message: VISION_UX_MESSAGES[stage], requestId, scopeId }
    })
  }

  try {
    // ===== GET HUB SETTINGS =====
    const data = await chrome.storage.local.get('settings-store')
    let settingsStore: PersistedStore<SettingsStateWithAuth>
    if (typeof data?.['settings-store'] === 'string') {
      settingsStore = JSON.parse(data['settings-store'])
    } else {
      settingsStore = data?.['settings-store']
    }

    const hubUrl = settingsStore?.state?.hubUrl
    const hubAccessToken = settingsStore?.state?.hubAccessToken
    const hubRefreshToken = settingsStore?.state?.hubRefreshToken

    if (!hubAccessToken || !hubUrl) {
      port.postMessage({
        type: 'STREAM_CHUNK',
        payload: {
          delta: 'Please connect to Yumi Hub to use vision features. Open settings and enter your invite code.',
          requestId,
          scopeId
        },
      })
      port.postMessage({ type: 'STREAM_END', payload: { requestId, scopeId, elapsedMs: Date.now() - startTime } })
      return
    }

    log.log('[Vision] Query via Hub API')

    // Get personality data
    const personalityData = await chrome.storage.local.get('personality-store')
    let personalityStore: PersistedStore<PersonalityState>
    if (typeof personalityData?.['personality-store'] === 'string') {
      personalityStore = JSON.parse(personalityData['personality-store'])
    } else {
      personalityStore = personalityData?.['personality-store']
    }
    const activePersonalityId = personalityStore?.state?.activeId
    const personalities = personalityStore?.state?.list || []
    const activePersonality = personalities.find((p: Personality) => p.id === activePersonalityId)

    sendStageIndicator('analyzing')

    const controller = new AbortController()
    activeVisionControllers.set(requestId, controller)

    // Build system prompt for vision
    const systemPrompt = buildSingleStageVisionPrompt(!!imageBase64, {
      prompt: prompt || '',
      pageTitle: imageContext?.pageTitle,
      domain: imageContext?.domain,
    }, activePersonality)

    // Build messages for API request
    type APIMessage = {
      role: 'system' | 'user' | 'assistant'
      content: string | Array<{
        type: string
        text?: string
        image_url?: {url: string; detail: string}
      }>
    }
    const messages: APIMessage[] = [
      { role: 'system', content: systemPrompt },
    ]

    // Add history for context
    if (history && history.length > 0) {
      messages.push(...history.slice(-4))
    }

    // Add user query with image if present
    if (imageBase64) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageBase64, detail: 'high' } },
        ],
      })
    } else {
      messages.push({ role: 'user', content: prompt || '' })
    }

    // Use vision-capable model (gpt-4o-mini supports vision)
    const model = MODELS.VISION_DEFAULT

    sendStageIndicator('thinking')

    // Stream through Hub
    const response = await fetch(`${hubUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${hubAccessToken}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: SAMPLING.VISION_TEMPERATURE,
        max_tokens: API.VISION_MAX_TOKENS,
      }),
      signal: controller.signal,
    })

    // Handle 401 - token might be expired
    if (response.status === 401) {
      log.log('[Vision] Hub token expired, attempting refresh')
      const refreshed = await tryRefreshHubToken({
        hubUrl,
        hubAccessToken,
        hubRefreshToken: hubRefreshToken || null,
        settingsStore
      } as HubConfig)
      if (!refreshed) {
        port.postMessage({
          type: 'STREAM_ERROR',
          payload: { error: 'Hub session expired. Please log in again.', requestId, scopeId }
        })
        return
      }
      // Retry with new token (recursive call)
      activeVisionControllers.delete(requestId)
      await handleVisionQuery(port, payload)
      return
    }

    if (!response.ok || !response.body) {
      const errText = await response.text().catch(() => 'Vision request failed')
      throw new Error(`Hub API error ${response.status}: ${errText}`)
    }

    // Stream response to user
    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      let idx

      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)

        for (const line of event.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue

          const data = trimmed.slice(5).trim()
          if (!data) continue
          if (data === '[DONE]') {
            const elapsed = Date.now() - startTime
            log.log(`[Vision] Query complete in ${elapsed}ms`)
            port.postMessage({
              type: 'STREAM_END',
              payload: { requestId, scopeId, elapsedMs: elapsed }
            })
            return
          }

          try {
            const json = JSON.parse(data)
            const rawDelta = json?.choices?.[0]?.delta?.content || ''

            if (rawDelta) {
              port.postMessage({
                type: 'STREAM_CHUNK',
                payload: { delta: rawDelta, requestId, scopeId }
              })
            }
          } catch {
            // non-json diagnostic lines ignored
          }
        }
      }
    }

    // If we exit without [DONE]
    const elapsed = Date.now() - startTime
    log.log(`[Vision] Stream ended without [DONE], total: ${elapsed}ms`)
    port.postMessage({
      type: 'STREAM_END',
      payload: { requestId, scopeId, elapsedMs: elapsed }
    })

  } catch (error) {
    const elapsed = Date.now() - startTime
    log.error('[Vision] Query error:', error)
    sendStageIndicator('error')
    port.postMessage({
      type: 'STREAM_ERROR',
      payload: { error: getErrorMessage(error), requestId, scopeId, elapsedMs: elapsed },
    })
  } finally {
    activeVisionControllers.delete(requestId)
  }
}
