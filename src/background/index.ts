/**
 * Background Service Worker (MV3)
 *
 * Entry point for background script that orchestrates all background modules.
 * Handles Chrome extension lifecycle and routes messages to appropriate handlers.
 */

import { z } from 'zod'
import { createLogger } from '../lib/core/debug'
import { setupExternalMessaging } from './externalMessaging'
import { initializeContextMenus, setupContextMenuHandlers } from './contextMenu'
import { initializePortHandlers } from './portManager'
import { handleMemoryExtraction } from './memory'
import { handleSearchRequest } from './search'
import { AUDIO } from '../lib/config/constants'
import { getErrorMessage } from '../lib/core/errors'
import { registerBuiltinPlugins } from '../lib/plugins/builtin'
import {
  initMemoryDB,
  getAllMemories,
  saveMemory,
  saveMemories,
  deleteMemory,
  clearAllMemories
} from '../lib/memory/db'
import {
  initCompanionDB,
  getCompanionMetadata,
  getCompanionFileAsDataUrl,
  markCompanionUsed,
} from '../lib/companions/db'
import type { RuntimeMessage } from '../types'

const log = createLogger('Background')

/** Memory type enum matching types.ts */
const MemoryTypeSchema = z.enum(['identity', 'preference', 'skill', 'project', 'person', 'event', 'opinion'])

/** Memory source schema matching types.ts */
const MemorySourceSchema = z.object({
  conversationId: z.string(),
  messageId: z.string(),
  url: z.string().optional(),
  timestamp: z.number()
})

/** Full Memory schema matching types.ts Memory interface */
const MemorySchema = z.object({
  id: z.string(),
  type: MemoryTypeSchema,
  content: z.string().min(1).max(10000),
  context: z.string().optional(),
  source: MemorySourceSchema,
  importance: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  lastAccessed: z.number(),
  accessCount: z.number(),
  createdAt: z.number(),
  expiresAt: z.number().optional()
})

/**
 * Zod schemas for message payload validation
 * Security: Validates external input to prevent injection attacks
 */
const MessagePayloadSchemas = {
  FETCH_IMAGE: z.object({
    url: z.string().url()
  }),
  MEMORY_ADD: z.object({
    memory: MemorySchema
  }),
  MEMORY_ADD_BATCH: z.object({
    memories: z.array(MemorySchema)
  }),
  MEMORY_DELETE: z.object({
    id: z.string().min(1)
  }),
  COMPANION_GET_METADATA: z.object({
    slug: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/)
  }),
  COMPANION_GET_FILE_URL: z.object({
    slug: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
    filePath: z.string().min(1).max(500)
  }),
  COMPANION_MARK_USED: z.object({
    slug: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/)
  }),
  SEARCH_REQUEST: z.object({
    query: z.string().min(1).max(1000)
  })
}

/** Safe payload parser with logging */
function parsePayload<T extends keyof typeof MessagePayloadSchemas>(
  type: T,
  payload: unknown
): z.infer<typeof MessagePayloadSchemas[T]> | null {
  const schema = MessagePayloadSchemas[type]
  const result = schema.safeParse(payload)
  if (!result.success) {
    log.warn(`[Background] Invalid payload for ${type}:`, result.error.issues)
    return null
  }
  return result.data
}

/**
 * Register all builtin plugins with the registry
 */
registerBuiltinPlugins()

/**
 * Setup external messaging for website communication
 */
setupExternalMessaging()

/**
 * Initialize Chrome extension on install/update
 */
chrome.runtime.onInstalled.addListener(() => {
  log.log('[Background] Yumi installed/updated')
  initializeContextMenus()
  // Initialize memory database
  initMemoryDB().catch(err => log.error('Failed to init memory DB:', err))
})

/**
 * Initialize databases on service worker startup
 */
initMemoryDB().catch(err => log.error('Failed to init memory DB:', err))
initCompanionDB().catch(err => log.error('Failed to init companion DB:', err))

/**
 * Setup context menu click handlers
 */
setupContextMenuHandlers()

/**
 * Initialize port-based streaming connections
 */
initializePortHandlers()

/**
 * Safe message sender - silently fails if no receiver exists
 */
function safeSendMessage(message: RuntimeMessage) {
  chrome.runtime.sendMessage(message).catch((err) => {
    const errorMsg = getErrorMessage(err)
    if (!errorMsg.includes('Receiving end does not exist')) {
      log.warn('[Background] Unexpected message send failure:', errorMsg)
    }
  })
}

/**
 * Main background message router
 *
 * Handles:
 * - FETCH_IMAGE: Fetch CORS-protected images
 * - CAPTURE_SCREENSHOT: Capture visible tab for vision queries
 * - MEMORY_EXTRACTION: Extract memories from conversation
 */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  /**
   * FETCH_IMAGE - Fetch CORS-protected images
   */
  if (msg.type === 'FETCH_IMAGE') {
    (async () => {
      try {
        const payload = parsePayload('FETCH_IMAGE', msg.payload)
        if (!payload) {
          safeSendMessage({
            type: 'FETCH_IMAGE_RESULT',
            payload: { success: false, error: 'Invalid or missing URL' }
          })
          return
        }

        const response = await fetch(payload.url)
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
              blob: reader.result as string
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
      } catch (err) {
        safeSendMessage({
          type: 'FETCH_IMAGE_RESULT',
          payload: {
            success: false,
            error: getErrorMessage(err, 'Unknown error')
          }
        })
      }
    })()
    return true
  }

  /**
   * CAPTURE_SCREENSHOT - Capture visible tab screenshot
   */
  if (msg.type === 'CAPTURE_SCREENSHOT') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (!tab?.id) {
          sendResponse({ success: false, error: 'No active tab found' })
          return
        }

        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: 'jpeg',
          quality: AUDIO.SCREENSHOT_JPEG_QUALITY
        })

        log.log('[Background] Screenshot captured, size:', Math.round(dataUrl.length / 1024), 'KB')
        sendResponse({ success: true, screenshot: dataUrl })
      } catch (err) {
        log.error('[Background] Screenshot capture failed:', err)
        sendResponse({
          success: false,
          error: getErrorMessage(err, 'Failed to capture screenshot')
        })
      }
    })()
    return true
  }

  /**
   * MEMORY_EXTRACTION - Extract memories from conversation
   */
  if (msg.type === 'MEMORY_EXTRACTION') {
    (async () => {
      const response = await handleMemoryExtraction(msg.payload)
      sendResponse(response)
    })()
    return true
  }

  /**
   * MEMORY_GET_ALL - Get all memories from IndexedDB
   */
  if (msg.type === 'MEMORY_GET_ALL') {
    (async () => {
      try {
        const memories = await getAllMemories()
        sendResponse({ success: true, memories })
      } catch (err) {
        log.error('Failed to get memories:', err)
        sendResponse({ success: false, error: getErrorMessage(err) })
      }
    })()
    return true
  }

  /**
   * MEMORY_ADD - Save a single memory
   */
  if (msg.type === 'MEMORY_ADD') {
    (async () => {
      try {
        const payload = parsePayload('MEMORY_ADD', msg.payload)
        if (!payload) {
          sendResponse({ success: false, error: 'Invalid memory payload' })
          return
        }
        await saveMemory(payload.memory)
        sendResponse({ success: true })
      } catch (err) {
        log.error('Failed to save memory:', err)
        sendResponse({ success: false, error: getErrorMessage(err) })
      }
    })()
    return true
  }

  /**
   * MEMORY_ADD_BATCH - Save multiple memories
   */
  if (msg.type === 'MEMORY_ADD_BATCH') {
    (async () => {
      try {
        const payload = parsePayload('MEMORY_ADD_BATCH', msg.payload)
        if (!payload) {
          sendResponse({ success: false, error: 'Invalid memories payload' })
          return
        }
        await saveMemories(payload.memories)
        sendResponse({ success: true })
      } catch (err) {
        log.error('Failed to save memories:', err)
        sendResponse({ success: false, error: getErrorMessage(err) })
      }
    })()
    return true
  }

  /**
   * MEMORY_DELETE - Delete a memory by ID
   */
  if (msg.type === 'MEMORY_DELETE') {
    (async () => {
      try {
        const payload = parsePayload('MEMORY_DELETE', msg.payload)
        if (!payload) {
          sendResponse({ success: false, error: 'Invalid memory ID' })
          return
        }
        await deleteMemory(payload.id)
        sendResponse({ success: true })
      } catch (err) {
        log.error('Failed to delete memory:', err)
        sendResponse({ success: false, error: getErrorMessage(err) })
      }
    })()
    return true
  }

  /**
   * MEMORY_CLEAR_ALL - Clear all memories
   */
  if (msg.type === 'MEMORY_CLEAR_ALL') {
    (async () => {
      try {
        await clearAllMemories()
        sendResponse({ success: true })
      } catch (err) {
        log.error('Failed to clear memories:', err)
        sendResponse({ success: false, error: getErrorMessage(err) })
      }
    })()
    return true
  }

  /**
   * SEARCH_REQUEST - Web search via Hub API
   */
  if (msg.type === 'SEARCH_REQUEST') {
    (async () => {
      const payload = parsePayload('SEARCH_REQUEST', msg.payload)
      if (!payload) {
        sendResponse({ success: false, error: 'Invalid search query' })
        return
      }
      const response = await handleSearchRequest(payload)
      sendResponse(response)
    })()
    return true
  }

  /**
   * COMPANION_GET_METADATA - Get companion metadata from IndexedDB
   */
  if (msg.type === 'COMPANION_GET_METADATA') {
    (async () => {
      try {
        const payload = parsePayload('COMPANION_GET_METADATA', msg.payload)
        if (!payload) {
          sendResponse({ success: false, error: 'Invalid companion slug' })
          return
        }
        const metadata = await getCompanionMetadata(payload.slug)
        sendResponse({ success: true, metadata })
      } catch (err) {
        log.error('Failed to get companion metadata:', err)
        sendResponse({ success: false, error: getErrorMessage(err) })
      }
    })()
    return true
  }

  /**
   * COMPANION_GET_FILE_URL - Get data URL for companion file (for cross-context use)
   */
  if (msg.type === 'COMPANION_GET_FILE_URL') {
    (async () => {
      try {
        const payload = parsePayload('COMPANION_GET_FILE_URL', msg.payload)
        if (!payload) {
          sendResponse({ success: false, error: 'Invalid companion file request' })
          return
        }
        const url = await getCompanionFileAsDataUrl(payload.slug, payload.filePath)
        sendResponse({ success: true, url })
      } catch (err) {
        log.error('Failed to get companion file URL:', err)
        sendResponse({ success: false, error: getErrorMessage(err) })
      }
    })()
    return true
  }

  /**
   * COMPANION_MARK_USED - Update companion's lastUsedAt timestamp
   */
  if (msg.type === 'COMPANION_MARK_USED') {
    (async () => {
      try {
        const payload = parsePayload('COMPANION_MARK_USED', msg.payload)
        if (!payload) {
          sendResponse({ success: false, error: 'Invalid companion slug' })
          return
        }
        await markCompanionUsed(payload.slug)
        sendResponse({ success: true })
      } catch (err) {
        log.error('Failed to mark companion used:', err)
        sendResponse({ success: false, error: getErrorMessage(err) })
      }
    })()
    return true
  }

  return false
})

log.log('[Background] Service worker initialized')
