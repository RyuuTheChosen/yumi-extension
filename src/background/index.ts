// Background service worker (MV3)
// Handles AI streaming via Hub API, port connections, memory extraction, and vision queries

import { createLogger } from '../lib/debug'
import { setupExternalMessaging } from './externalMessaging'

const log = createLogger('Background')

// Setup external messaging for website communication
setupExternalMessaging()

chrome.runtime.onInstalled.addListener(() => {
  log.log('Yumi installed')

  // Create context menu for image analysis
  chrome.contextMenus.create({
    id: 'yumi-analyze-image',
    title: 'Ask Yumi about this image',
    contexts: ['image'],
  })

  // Context menu for selected text
  chrome.contextMenus.create({
    id: 'yumi-analyze-selection',
    title: 'Ask Yumi about this',
    contexts: ['selection'],
  })

  // Context menu for any element (fallback for reading page content)
  chrome.contextMenus.create({
    id: 'yumi-read-element',
    title: 'Let Yumi read this',
    contexts: ['page', 'frame', 'link'],
  })
})

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return

  if (info.menuItemId === 'yumi-analyze-image' && info.srcUrl) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'ANALYZE_IMAGE',
      payload: { imageUrl: info.srcUrl },
    }).catch(() => {
      log.warn('[WARN] Failed to send ANALYZE_IMAGE to content script')
    })
  }

  // Handle selected text
  if (info.menuItemId === 'yumi-analyze-selection' && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'CONTEXT_MENU_SELECTION',
      payload: { text: info.selectionText },
    }).catch(() => {
      log.warn('[WARN] Failed to send CONTEXT_MENU_SELECTION to content script')
    })
  }

  // Handle element reading (triggers content script to read last right-clicked element)
  if (info.menuItemId === 'yumi-read-element') {
    chrome.tabs.sendMessage(tab.id, {
      type: 'CONTEXT_MENU_READ_ELEMENT',
      payload: {},
    }).catch(() => {
      log.warn('[WARN] Failed to send CONTEXT_MENU_READ_ELEMENT to content script')
    })
  }
})

import { buildChatSystemPrompt } from '../lib/prompts'
import {
  buildSingleStageVisionPrompt,
  VISION_UX_MESSAGES,
} from '../lib/prompts/vision'

// Active abort controllers keyed by requestId for cancellation
const activeControllers = new Map<string, AbortController>()

// Port-based connections for persistent streaming
// Store by tabId to prevent GC and enable proper lifecycle management
interface PortConnection {
  port: chrome.runtime.Port
  tabId: number | null
  connectTime: number
}

const activePorts = new Map<string, PortConnection>()

// Safe message sender - silently fails if no receiver exists
function safeSendMessage(message: any) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Silently ignore "Receiving end does not exist" errors
    // This happens when sidepanel/content script isn't open
  })
}


/**
 * Vision Query Handler - Hub Only
 *
 * Routes all vision queries through the Hub API.
 * Hub handles provider selection and API key management.
 */
async function handleVisionQuery(port: chrome.runtime.Port, payload: any) {
  const startTime = Date.now()
  const { requestId, source, prompt, imageBase64, scopeId, history, imageContext } = payload

  log.log(` Vision query from ${source}`, {
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
    let settingsStore: any
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

    log.log(` Vision query via Hub API`)

    // Get personality data
    const personalityData = await chrome.storage.local.get('personality-store')
    let personalityStore: any
    if (typeof personalityData?.['personality-store'] === 'string') {
      personalityStore = JSON.parse(personalityData['personality-store'])
    } else {
      personalityStore = personalityData?.['personality-store']
    }
    const activePersonalityId = personalityStore?.state?.activeId
    const personalities = personalityStore?.state?.list || []
    const activePersonality = personalities.find((p: any) => p.id === activePersonalityId)

    sendStageIndicator('analyzing')

    const controller = new AbortController()
    activeControllers.set(requestId, controller)

    // Build system prompt for vision
    const systemPrompt = buildSingleStageVisionPrompt(!!imageBase64, {
      prompt,
      pageTitle: imageContext?.pageTitle,
      domain: imageContext?.domain,
    }, activePersonality)

    // Build messages
    const messages: any[] = [
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
      messages.push({ role: 'user', content: prompt })
    }

    // Use vision-capable model (gpt-4o-mini supports vision)
    const model = 'gpt-4o-mini'

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
        temperature: 0.7,
        max_tokens: 800,
      }),
      signal: controller.signal,
    })

    // Handle 401 - token might be expired
    if (response.status === 401) {
      log.log(' Vision: Hub token expired, attempting refresh')
      const refreshed = await tryRefreshHubToken({ hubUrl, hubAccessToken, hubRefreshToken, settingsStore })
      if (!refreshed) {
        port.postMessage({
          type: 'STREAM_ERROR',
          payload: { error: 'Hub session expired. Please log in again.', requestId, scopeId }
        })
        return
      }
      // Retry with new token (recursive call)
      activeControllers.delete(requestId)
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
            log.log(` Vision query complete in ${elapsed}ms`)
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
    log.log(` Vision stream ended without [DONE], total: ${elapsed}ms`)
    port.postMessage({
      type: 'STREAM_END',
      payload: { requestId, scopeId, elapsedMs: elapsed }
    })

  } catch (error: any) {
    const elapsed = Date.now() - startTime
    log.error(' Vision query error:', error)
    sendStageIndicator('error')
    port.postMessage({
      type: 'STREAM_ERROR',
      payload: { error: String(error), requestId, scopeId, elapsedMs: elapsed },
    })
  } finally {
    activeControllers.delete(requestId)
  }
}


// Main background message router: handles image fetching, screenshots, and memory extraction
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'FETCH_IMAGE') {
    // Handle image fetching for CORS-protected images
    (async () => {
      try {
        const { url } = msg.payload || {}
        if (!url) {
          safeSendMessage({ 
            type: 'FETCH_IMAGE_RESULT', 
            payload: { success: false, error: 'No URL provided' } 
          })
          return
        }
        
        const response = await fetch(url)
        if (!response.ok) {
          safeSendMessage({ 
            type: 'FETCH_IMAGE_RESULT', 
            payload: { success: false, error: `HTTP ${response.status}` } 
          })
          return
        }
        
        const blob = await response.blob()
        const reader = new FileReader()
        
        reader.onloadend = () => {
          safeSendMessage({ 
            type: 'FETCH_IMAGE_RESULT', 
            payload: { 
              success: true, 
              blob: reader.result as string // base64 data URL
            } 
          })
        }
        
        reader.onerror = () => {
          safeSendMessage({ 
            type: 'FETCH_IMAGE_RESULT', 
            payload: { success: false, error: 'Failed to read blob' } 
          })
        }
        
        reader.readAsDataURL(blob)
      } catch (err: any) {
        safeSendMessage({ 
          type: 'FETCH_IMAGE_RESULT', 
          payload: { 
            success: false, 
            error: err?.message || 'Unknown error' 
          } 
        })
      }
    })()
    return true // Keep message channel open for async response
  }

  if (msg.type === 'CAPTURE_SCREENSHOT') {
    // Capture visible tab screenshot for vision queries
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (!tab?.id) {
          sendResponse({ success: false, error: 'No active tab found' })
          return
        }

        // Capture the visible tab
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: 'jpeg',
          quality: 70  // Balance quality vs size
        })

        log.log(' Screenshot captured, size:', Math.round(dataUrl.length / 1024), 'KB')
        sendResponse({ success: true, screenshot: dataUrl })
      } catch (err: any) {
        log.error(' Screenshot capture failed:', err)
        sendResponse({
          success: false,
          error: err?.message || 'Failed to capture screenshot'
        })
      }
    })()
    return true // Keep message channel open for async response
  }

  // ===== MEMORY EXTRACTION =====
  // Non-streaming API call for extracting memories from conversations
  // Routes through Hub API with quota exemption header
  if (msg.type === 'MEMORY_EXTRACTION') {
    const { requestId, systemPrompt, userPrompt } = msg.payload || {}

    log.log(` Memory extraction request: ${requestId}`)

    ;(async () => {
      try {
        // Get Hub settings
        const data = await chrome.storage.local.get('settings-store')
        let settingsStore: any
        if (typeof data?.['settings-store'] === 'string') {
          settingsStore = JSON.parse(data['settings-store'])
        } else {
          settingsStore = data?.['settings-store']
        }

        const hubUrl = settingsStore?.state?.hubUrl
        const hubAccessToken = settingsStore?.state?.hubAccessToken
        const hubRefreshToken = settingsStore?.state?.hubRefreshToken

        if (!hubAccessToken || !hubUrl) {
          sendResponse({ success: false, error: 'Hub not connected' })
          return
        }

        log.log(' Memory extraction via Hub API')

        const response = await fetch(`${hubUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${hubAccessToken}`,
            'X-Yumi-Request-Type': 'memory-extraction', // Exempt from quota
          },
          body: JSON.stringify({
            model: 'deepseek-chat', // Cheap model for extraction
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            stream: false,
            temperature: 0.3,
            max_tokens: 1000,
          }),
        })

        // Handle 401 - token might be expired
        if (response.status === 401) {
          log.log(' Memory extraction: Hub token expired, attempting refresh')
          const refreshed = await tryRefreshHubToken({ hubUrl, hubAccessToken, hubRefreshToken, settingsStore })
          if (refreshed) {
            // Get new token and retry
            const newData = await chrome.storage.local.get('settings-store')
            let newSettingsStore: any
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
                model: 'deepseek-chat',
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: userPrompt },
                ],
                stream: false,
                temperature: 0.3,
                max_tokens: 1000,
              }),
            })

            if (!retryResponse.ok) {
              const errText = await retryResponse.text().catch(() => 'Unknown error')
              sendResponse({ success: false, error: `API error ${retryResponse.status}: ${errText}` })
              return
            }

            const json = await retryResponse.json()
            const content = json.choices?.[0]?.message?.content || ''
            log.log(` Memory extraction complete (after refresh), response length: ${content.length}`)
            sendResponse({ success: true, raw: content })
            return
          } else {
            sendResponse({ success: false, error: 'Hub session expired. Please log in again.' })
            return
          }
        }

        if (!response.ok) {
          const errText = await response.text().catch(() => 'Unknown error')
          sendResponse({ success: false, error: `API error ${response.status}: ${errText}` })
          return
        }

        const json = await response.json()
        const content = json.choices?.[0]?.message?.content || ''

        log.log(` Memory extraction complete, response length: ${content.length}`)

        sendResponse({ success: true, raw: content })

      } catch (err: any) {
        log.error(' Memory extraction error:', err)
        sendResponse({ success: false, error: err?.message || 'Unknown error' })
      }
    })()

    // Return true to indicate we will call sendResponse asynchronously
    return true
  }
})

// ===== PORT-BASED STREAMING FOR OVERLAY =====
// Persistent connections allow real-time streaming without message overhead
// Ports are stored to prevent GC and enable keep-alive

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'yumi-chat') return
  
  // Get tab ID from sender (null for popup/sidepanel)
  const tabId = port.sender?.tab?.id || null
  const portId = tabId !== null ? `tab-${tabId}` : crypto.randomUUID()
  
  log.log(` Port connected: ${port.name} (${portId})`)
  
  // Store port to prevent GC and enable heartbeat
  activePorts.set(portId, {
    port,
    tabId,
    connectTime: Date.now()
  })
  
  port.onMessage.addListener(async (msg) => {
    const startTime = Date.now()
    
    switch (msg.type) {
      case 'SEND_MESSAGE':
        await streamToPort(port, msg.payload, startTime)
        break
        
      case 'VISION_QUERY':
        await handleVisionQuery(port, msg.payload)
        break
        
      case 'HEARTBEAT':
        // Respond to heartbeat to keep connection alive
        try {
          port.postMessage({ type: 'PONG' })
        } catch (err) {
          log.error(' Heartbeat response failed:', err)
        }
        break
    }
  })
  
  port.onDisconnect.addListener(() => {
    const connection = activePorts.get(portId)
    if (connection) {
      const elapsed = Date.now() - connection.connectTime
      log.log(` Port disconnected: ${port.name} (${portId}, lived ${elapsed}ms)`)
    }
    activePorts.delete(portId)
  })
})

interface PortStreamPayload {
  scopeId: string
  content: string
  context?: Record<string, any>
  requestId: string
  history?: Array<{ role: string; content: string }>
  memoryContext?: string  // Formatted memory context from content script
  pageType?: string       // Page type from context extraction
  pageContext?: string    // Formatted page context from content script (deprecated)
  selectedContext?: string // User-selected content from right-click context menu
  screenshot?: string     // Base64 screenshot for vision queries
}

interface HubConfig {
  hubUrl: string
  hubAccessToken: string
  hubRefreshToken: string | null
  settingsStore: any
}

/**
 * Stream chat completion through AI Hub API
 * Hub handles provider selection and API key management
 */
async function streamViaHub(
  port: chrome.runtime.Port,
  payload: PortStreamPayload,
  startTime: number,
  hubConfig: HubConfig
) {
  const { scopeId, content, requestId, history, memoryContext, pageType, pageContext, selectedContext, screenshot } = payload
  const { hubUrl, hubAccessToken, settingsStore } = hubConfig

  log.log(` Hub streaming for scope: ${scopeId}, requestId: ${requestId}`)

  try {
    // Get personality data for system prompt
    const personalityData = await chrome.storage.local.get('personality-store')
    let personalityStore: any
    if (typeof personalityData?.['personality-store'] === 'string') {
      personalityStore = JSON.parse(personalityData['personality-store'])
    } else {
      personalityStore = personalityData?.['personality-store']
    }

    const activePersonalityId = personalityStore?.state?.activeId
    const personalities = personalityStore?.state?.list || []
    const activePersonality = personalities.find((p: any) => p.id === activePersonalityId)

    // Build messages array with system prompt
    const messages: Array<{ role: string; content: any }> = []

    // Build pageInfo for the prompt
    const pageInfo = (selectedContext || pageContext)
      ? { pageType, pageContext, selectedContext }
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
      log.log(` Hub: Including ${history.length} history messages`)
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
      log.log(' Hub: Including screenshot for vision')
    } else {
      messages.push({ role: 'user', content })
    }

    // Determine model - Hub will route to appropriate provider
    // DeepSeek for chat, GPT-4o-mini for vision (has image capability)
    const model = screenshot
      ? 'gpt-4o-mini'
      : 'deepseek-chat'

    const controller = new AbortController()
    activeControllers.set(requestId, controller)

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
        temperature: 0.8,
        presence_penalty: 0.4,
        frequency_penalty: 0.3,
        max_tokens: 800,
        top_p: 0.9,
      }),
      signal: controller.signal,
    })

    // Handle 401 - token might be expired
    if (res.status === 401) {
      log.log(' Hub token expired, attempting refresh')
      // Try to refresh token
      const refreshed = await tryRefreshHubToken(hubConfig)
      if (refreshed) {
        // Retry with new token (recursive call with updated config)
        log.log(' Hub token refreshed, retrying')
        activeControllers.delete(requestId)
        const newData = await chrome.storage.local.get('settings-store')
        let newSettingsStore: any
        if (typeof newData?.['settings-store'] === 'string') {
          newSettingsStore = JSON.parse(newData['settings-store'])
        } else {
          newSettingsStore = newData?.['settings-store']
        }
        const newHubConfig: HubConfig = {
          hubUrl,
          hubAccessToken: newSettingsStore?.state?.hubAccessToken,
          hubRefreshToken: newSettingsStore?.state?.hubRefreshToken,
          settingsStore: newSettingsStore
        }
        await streamViaHub(port, payload, startTime, newHubConfig)
        return
      } else {
        // Refresh failed - clear auth and error
        log.error(' Hub token refresh failed')
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
            log.log(` Hub stream completed in ${elapsed}ms`)
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
    log.log(` Hub stream ended without [DONE], total: ${elapsed}ms`)
    port.postMessage({
      type: 'STREAM_END',
      payload: { requestId, scopeId, elapsedMs: elapsed }
    })

  } catch (err: any) {
    const elapsed = Date.now() - startTime
    log.error(` Hub stream error after ${elapsed}ms:`, err)
    port.postMessage({
      type: 'STREAM_ERROR',
      payload: { error: String(err), requestId, scopeId, elapsedMs: elapsed }
    })
  } finally {
    activeControllers.delete(requestId)
  }
}

/**
 * Try to refresh Hub access token using refresh token
 */
async function tryRefreshHubToken(hubConfig: HubConfig): Promise<boolean> {
  const { hubUrl, hubRefreshToken } = hubConfig
  if (!hubRefreshToken) return false

  try {
    const res = await fetch(`${hubUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: hubRefreshToken })
    })

    if (!res.ok) {
      log.error(' Hub refresh failed:', res.status)
      // Clear auth on failure
      await updateHubAuth(null, null, null)
      return false
    }

    const data = await res.json()
    // Update stored tokens
    await updateHubAuth(data.accessToken, data.refreshToken, data.user || hubConfig.settingsStore?.state?.hubUser)
    return true
  } catch (err) {
    log.error(' Hub refresh error:', err)
    return false
  }
}

/**
 * Update Hub auth in settings store
 */
async function updateHubAuth(accessToken: string | null, refreshToken: string | null, user: any) {
  const data = await chrome.storage.local.get('settings-store')
  let settingsStore: any
  if (typeof data?.['settings-store'] === 'string') {
    settingsStore = JSON.parse(data['settings-store'])
  } else {
    settingsStore = data?.['settings-store'] || { state: {} }
  }

  settingsStore.state = {
    ...settingsStore.state,
    hubAccessToken: accessToken,
    hubRefreshToken: refreshToken,
    hubUser: user
  }

  await chrome.storage.local.set({ 'settings-store': JSON.stringify(settingsStore) })
  log.log(' Hub auth updated in storage')
}

async function streamToPort(port: chrome.runtime.Port, payload: PortStreamPayload, startTime: number) {
  const { scopeId, requestId } = payload

  log.log(` Streaming to port for scope: ${scopeId}, requestId: ${requestId}`)

  try {
    // Get settings
    const data = await chrome.storage.local.get('settings-store')
    let settingsStore: any
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
      log.log(' Hub not connected')
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

    log.log(' Routing through AI Hub')
    await streamViaHub(port, payload, startTime, { hubUrl, hubAccessToken, hubRefreshToken, settingsStore })

  } catch (err) {
    const elapsed = Date.now() - startTime
    log.error(` Port stream error after ${elapsed}ms:`, err)
    try {
      port.postMessage({
        type: 'STREAM_ERROR',
        payload: { error: String(err), requestId, scopeId, elapsedMs: elapsed }
      })
    } catch (postErr) {
      log.error(' Failed to send STREAM_ERROR:', postErr)
    }
  }
}
