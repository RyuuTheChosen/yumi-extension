/**
 * AI Streaming Module
 *
 * Handles AI chat streaming through Hub API with SSE parsing.
 * Manages streaming responses to content script via Chrome ports.
 */

import { createLogger } from '../lib/debug'
import { buildChatSystemPrompt } from '../lib/prompts'
import { API, SAMPLING, MODELS } from '../lib/constants'
import { getErrorMessage } from '../lib/errors'
import { tryRefreshHubToken, type HubConfig } from './auth'
import type {
  SettingsStateWithAuth,
  PersonalityState,
  Personality,
  MessageContent,
} from '../types'

const log = createLogger('Streaming')

/**
 * Persisted store structure (Zustand persist middleware wraps in 'state')
 */
interface PersistedStore<T> {
  state: T
  version: number
}

/**
 * Port stream payload
 */
export interface PortStreamPayload {
  scopeId: string
  content: string
  requestId: string
  history?: Array<{ role: string; content: string }>
  memoryContext?: string  // Formatted memory context from content script
  pageType?: string       // Page type from context extraction
  selectedContext?: string // User-selected content from right-click context menu
  searchContext?: string  // Web search results context
  screenshot?: string     // Base64 screenshot for vision queries
}

/**
 * Active abort controllers for cancellation
 */
export const activeStreamControllers = new Map<string, AbortController>()

/**
 * Stream chat completion through AI Hub API
 *
 * Hub handles provider selection and API key management.
 * Streams response back to content script via Chrome port.
 *
 * @param port - Chrome runtime port for streaming
 * @param payload - Stream request payload
 * @param startTime - Request start timestamp
 * @param hubConfig - Hub configuration
 */
export async function streamViaHub(
  port: chrome.runtime.Port,
  payload: PortStreamPayload,
  startTime: number,
  hubConfig: HubConfig
): Promise<void> {
  const { scopeId, content, requestId, history, memoryContext, pageType, selectedContext, searchContext, screenshot } = payload
  const { hubUrl, hubAccessToken, settingsStore } = hubConfig

  log.log(`[Streaming] Hub streaming for scope: ${scopeId}, requestId: ${requestId}`)

  try {
    // Get personality data for system prompt
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

    // Build messages array with system prompt
    const messages: Array<{ role: string; content: MessageContent }> = []

    // Build pageInfo for the prompt
    const pageInfo = (selectedContext || searchContext)
      ? { pageType, selectedContext, searchContext }
      : undefined

    const enhancedSystemPrompt = buildChatSystemPrompt(
      activePersonality,
      history?.length || 0,
      memoryContext,
      pageInfo
    )
    messages.push({ role: 'system', content: enhancedSystemPrompt })

    // Add conversation history
    if (history && Array.isArray(history) && history.length > 0) {
      messages.push(...history)
      log.log(`[Streaming] Hub: Including ${history.length} history messages`)
    }

    // Add user message - with screenshot if present
    if (screenshot) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: content },
          { type: 'image_url', image_url: { url: screenshot, detail: 'high' } }
        ]
      })
      log.log('[Streaming] Hub: Including screenshot for vision')
    } else {
      messages.push({ role: 'user', content })
    }

    // Determine model - Hub will route to appropriate provider
    // DeepSeek for chat, GPT-4o-mini for vision (has image capability)
    const model = screenshot
      ? MODELS.VISION_DEFAULT
      : MODELS.CHAT_DEFAULT

    const controller = new AbortController()
    activeStreamControllers.set(requestId, controller)

    // Call Hub API
    const res = await fetch(`${hubUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${hubAccessToken}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: SAMPLING.CHAT_TEMPERATURE,
        presence_penalty: SAMPLING.CHAT_PRESENCE_PENALTY,
        frequency_penalty: SAMPLING.CHAT_FREQUENCY_PENALTY,
        max_tokens: API.CHAT_MAX_TOKENS,
        top_p: SAMPLING.CHAT_TOP_P,
      }),
      signal: controller.signal,
    })

    // Handle 401 - token might be expired
    if (res.status === 401) {
      log.log('[Streaming] Hub token expired, attempting refresh')
      // Try to refresh token
      const refreshed = await tryRefreshHubToken(hubConfig)
      if (refreshed) {
        // Retry with new token (recursive call with updated config)
        log.log('[Streaming] Hub token refreshed, retrying')
        activeStreamControllers.delete(requestId)
        const newData = await chrome.storage.local.get('settings-store')
        let newSettingsStore: PersistedStore<SettingsStateWithAuth>
        if (typeof newData?.['settings-store'] === 'string') {
          newSettingsStore = JSON.parse(newData['settings-store'])
        } else {
          newSettingsStore = newData?.['settings-store']
        }
        const newHubConfig: HubConfig = {
          hubUrl,
          hubAccessToken: newSettingsStore?.state?.hubAccessToken || '',
          hubRefreshToken: newSettingsStore?.state?.hubRefreshToken || null,
          settingsStore: newSettingsStore
        }
        await streamViaHub(port, payload, startTime, newHubConfig)
        return
      } else {
        // Refresh failed - clear auth and error
        log.error('[Streaming] Hub token refresh failed')
        port.postMessage({
          type: 'STREAM_ERROR',
          payload: { error: 'Hub session expired. Please log in again.', requestId, scopeId }
        })
        return
      }
    }

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => 'Hub request failed')
      throw new Error(`Hub API error ${res.status}: ${errText}`)
    }

    // Stream response
    const reader = res.body.getReader()
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
            log.log(`[Streaming] Hub stream completed in ${elapsed}ms`)
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
    log.log(`[Streaming] Hub stream ended without [DONE], total: ${elapsed}ms`)
    port.postMessage({
      type: 'STREAM_END',
      payload: { requestId, scopeId, elapsedMs: elapsed }
    })

  } catch (err) {
    const elapsed = Date.now() - startTime
    log.error(`[Streaming] Hub stream error after ${elapsed}ms:`, err)
    port.postMessage({
      type: 'STREAM_ERROR',
      payload: { error: getErrorMessage(err), requestId, scopeId, elapsedMs: elapsed }
    })
  } finally {
    activeStreamControllers.delete(requestId)
  }
}

/**
 * Stream to port entry point
 *
 * Routes streaming request through Hub API.
 * Handles Hub authentication and error cases.
 *
 * @param port - Chrome runtime port for streaming
 * @param payload - Stream request payload
 * @param startTime - Request start timestamp
 */
export async function streamToPort(
  port: chrome.runtime.Port,
  payload: PortStreamPayload,
  startTime: number
): Promise<void> {
  const { scopeId, requestId } = payload

  log.log(`[Streaming] Streaming to port for scope: ${scopeId}, requestId: ${requestId}`)

  try {
    // Get settings
    const data = await chrome.storage.local.get('settings-store')
    let settingsStore: PersistedStore<SettingsStateWithAuth>
    if (typeof data?.['settings-store'] === 'string') {
      settingsStore = JSON.parse(data['settings-store'])
    } else {
      settingsStore = data?.['settings-store']
    }

    // Hub-only mode - require Hub authentication
    const hubUrl = settingsStore?.state?.hubUrl
    const hubAccessToken = settingsStore?.state?.hubAccessToken
    const hubRefreshToken = settingsStore?.state?.hubRefreshToken

    if (!hubAccessToken || !hubUrl) {
      log.log('[Streaming] Hub not connected')
      port.postMessage({
        type: 'STREAM_ERROR',
        payload: {
          error: 'Please connect to Yumi Hub to continue. Open settings and enter your invite code.',
          requestId,
          scopeId
        }
      })
      return
    }

    log.log('[Streaming] Routing through AI Hub')
    await streamViaHub(port, payload, startTime, {
      hubUrl,
      hubAccessToken,
      hubRefreshToken: hubRefreshToken || null,
      settingsStore
    })

  } catch (err) {
    const elapsed = Date.now() - startTime
    log.error(`[Streaming] Port stream error after ${elapsed}ms:`, err)
    try {
      port.postMessage({
        type: 'STREAM_ERROR',
        payload: { error: getErrorMessage(err), requestId, scopeId, elapsedMs: elapsed }
      })
    } catch (postErr) {
      log.error('[Streaming] Failed to send STREAM_ERROR:', postErr)
    }
  }
}
