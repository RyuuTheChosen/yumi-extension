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
import { handleEmbeddingGeneration } from './embedding'
import { handleSearchRequest } from './search'
import { migrateTokensToSecureStorage, getAccessToken, tryRefreshHubToken, setAccessToken, setRefreshToken } from './auth'
import { AUDIO, MEMORY } from '../lib/config/constants'
import { getErrorMessage } from '../lib/core/errors'
import { registerBuiltinPlugins } from '../lib/plugins/builtin'
import {
  initMemoryDB,
  getAllMemories,
  saveMemory,
  saveMemories,
  deleteMemory,
  deleteMemories,
  clearAllMemories,
  findSimilarMemory,
  getMemoriesPaginated,
  cleanupExpiredMemories,
  updateMemory,
  getAllEntityLinks,
  getEntitiesForMemory,
  removeMemoryFromEntities,
  saveSummary,
  getSummary,
  getSummaryByConversationId,
  getAllSummaries,
  getRecentSummaries,
  getSummariesForMemories
} from '../lib/memory/db'
import {
  processMemoryEntities,
  findRelatedMemories,
  getEntityStats
} from '../lib/memory/clustering'
import {
  initCompanionDB,
  getCompanionMetadata,
  getCompanionFileAsDataUrl,
  markCompanionUsed,
} from '../lib/companions/db'
import type { RuntimeMessage } from '../types'

const log = createLogger('Background')

/**
 * Sensitive message types that require sender validation
 */
const SENSITIVE_MESSAGE_TYPES = [
  'MEMORY_EXTRACTION',
  'MEMORY_EMBEDDING',
  'MEMORY_GET_ALL',
  'MEMORY_ADD',
  'MEMORY_ADD_BATCH',
  'MEMORY_ADD_WITH_DEDUP',
  'MEMORY_DELETE',
  'MEMORY_DELETE_BATCH',
  'MEMORY_UPDATE',
  'MEMORY_CLEAR_ALL',
  'ENTITY_GET_ALL',
  'ENTITY_GET_FOR_MEMORY',
  'ENTITY_GET_RELATED_MEMORIES',
  'ENTITY_PROCESS_MEMORY',
  'ENTITY_GET_STATS',
  'SUMMARY_GENERATE',
  'SUMMARY_GET',
  'SUMMARY_GET_ALL',
  'SUMMARY_GET_FOR_MEMORIES',
  'SUMMARY_SAVE',
  'GET_ACCESS_TOKEN',
  'REFRESH_ACCESS_TOKEN'
] as const

/**
 * Validate message sender is from extension context
 *
 * SECURITY: Enhanced validation beyond just extension ID
 * - Checks sender is from our extension
 * - For content scripts, validates the origin
 * - Blocks messages from other extensions masquerading as ours
 *
 * @param sender - Chrome runtime message sender
 * @returns true if sender is trusted (same extension context)
 */
function isValidSender(sender: chrome.runtime.MessageSender): boolean {
  /** Must be from our extension */
  if (sender.id !== chrome.runtime.id) {
    return false
  }

  /** For content scripts, verify origin is not from another extension */
  if (sender.tab && sender.url) {
    try {
      const url = new URL(sender.url)
      /** Block messages from chrome-extension:// URLs that aren't ours */
      if (url.protocol === 'chrome-extension:' && url.hostname !== chrome.runtime.id) {
        log.warn('[Security] Blocked message from foreign extension context')
        return false
      }
    } catch {
      /** Invalid URL - block to be safe */
      return false
    }
  }

  return true
}

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
  content: z.string().min(1).max(MEMORY.MAX_CONTENT_LENGTH),
  context: z.string().max(MEMORY.MAX_CONTEXT_LENGTH).optional(),
  source: MemorySourceSchema,
  importance: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  lastAccessed: z.number(),
  accessCount: z.number(),
  createdAt: z.number(),
  expiresAt: z.number().optional(),
  usageCount: z.number(),
  lastUsedAt: z.number().optional(),
  feedbackScore: z.number().min(-1).max(1),
  userVerified: z.boolean(),
  embedding: z.array(z.number()).optional(),
  embeddingModel: z.string().optional()
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
  MEMORY_DELETE_BATCH: z.object({
    ids: z.array(z.string().min(1))
  }),
  MEMORY_UPDATE: z.object({
    id: z.string().min(1),
    updates: z.object({
      content: z.string().min(1).max(MEMORY.MAX_CONTENT_LENGTH).optional(),
      context: z.string().max(MEMORY.MAX_CONTEXT_LENGTH).optional(),
      type: MemoryTypeSchema.optional(),
      importance: z.number().min(0).max(1).optional(),
      confidence: z.number().min(0).max(1).optional(),
      feedbackScore: z.number().min(-1).max(1).optional(),
      userVerified: z.boolean().optional()
    })
  }),
  MEMORY_ADD_WITH_DEDUP: z.object({
    memory: MemorySchema
  }),
  MEMORY_GET_PAGINATED: z.object({
    limit: z.number().min(1).max(100).optional(),
    offset: z.number().min(0).optional(),
    sortBy: z.enum(['importance', 'createdAt', 'lastAccessed']).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional()
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
  }),
  MEMORY_EXTRACTION: z.object({
    requestId: z.string().min(1).max(100),
    systemPrompt: z.string().min(1).max(10000),
    userPrompt: z.string().min(1).max(50000)
  }),
  MEMORY_EMBEDDING: z.object({
    texts: z.array(z.string().min(1).max(5000)).min(1).max(10),
    memoryIds: z.array(z.string()).optional()
  }),
  ENTITY_GET_FOR_MEMORY: z.object({
    memoryId: z.string().min(1)
  }),
  ENTITY_GET_RELATED_MEMORIES: z.object({
    memoryId: z.string().min(1),
    limit: z.number().min(1).max(20).optional()
  }),
  ENTITY_PROCESS_MEMORY: z.object({
    memory: MemorySchema
  }),
  SUMMARY_GENERATE: z.object({
    messages: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string()
    })).min(1).max(100),
    conversationId: z.string().min(1),
    maxLength: z.number().min(50).max(1000).optional(),
    maxTopics: z.number().min(1).max(10).optional()
  }),
  SUMMARY_GET: z.object({
    conversationId: z.string().min(1)
  }),
  SUMMARY_GET_FOR_MEMORIES: z.object({
    memoryIds: z.array(z.string().min(1)).min(1)
  }),
  SUMMARY_SAVE: z.object({
    summary: z.object({
      id: z.string(),
      conversationId: z.string(),
      summary: z.string(),
      keyTopics: z.array(z.string()),
      memoryIds: z.array(z.string()),
      messageCount: z.number(),
      url: z.string().optional(),
      conversationStartedAt: z.number(),
      conversationEndedAt: z.number(),
      createdAt: z.number(),
      embedding: z.array(z.number()).optional()
    })
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
 * SECURITY: Migrate legacy tokens to secure storage (v22 upgrade)
 * Access tokens -> chrome.storage.session
 * Refresh tokens -> AES-GCM encrypted in chrome.storage.local
 */
migrateTokensToSecureStorage().catch(err => log.error('Failed to migrate tokens:', err))

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
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  /** Validate sender for sensitive memory operations */
  if (SENSITIVE_MESSAGE_TYPES.includes(msg.type) && !isValidSender(sender)) {
    log.warn('[Background] Rejected message from untrusted sender:', msg.type)
    sendResponse({ success: false, error: 'Unauthorized sender' })
    return true
  }

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
   * SET_HUB_AUTH - Store tokens in secure storage after login
   */
  if (msg.type === 'SET_HUB_AUTH') {
    (async () => {
      try {
        const { accessToken, refreshToken } = msg.payload || {}
        if (accessToken) {
          await setAccessToken(accessToken)
        }
        if (refreshToken) {
          await setRefreshToken(refreshToken)
        }
        log.log('[Background] Tokens stored securely')
        sendResponse({ success: true })
      } catch (err) {
        log.error('[Background] Failed to store tokens:', err)
        sendResponse({ success: false, error: getErrorMessage(err) })
      }
    })()
    return true
  }

  /**
   * CLEAR_HUB_AUTH - Clear tokens from secure storage on logout
   */
  if (msg.type === 'CLEAR_HUB_AUTH') {
    (async () => {
      try {
        await setAccessToken(null)
        await setRefreshToken(null)
        log.log('[Background] Tokens cleared from secure storage')
        sendResponse({ success: true })
      } catch (err) {
        log.error('[Background] Failed to clear tokens:', err)
        sendResponse({ success: false, error: getErrorMessage(err) })
      }
    })()
    return true
  }

  /**
   * GET_ACCESS_TOKEN - Get access token from session storage
   * SECURITY: Only returns token to content scripts from same extension
   */
  if (msg.type === 'GET_ACCESS_TOKEN') {
    (async () => {
      try {
        const token = await getAccessToken()
        sendResponse({ success: true, token })
      } catch (err) {
        log.error('[Background] Failed to get access token:', err)
        sendResponse({ success: false, error: getErrorMessage(err) })
      }
    })()
    return true
  }

  /**
   * REFRESH_ACCESS_TOKEN - Refresh the access token using stored refresh token
   * SECURITY: Only returns token to content scripts from same extension
   */
  if (msg.type === 'REFRESH_ACCESS_TOKEN') {
    (async () => {
      try {
        const settingsData = await chrome.storage.local.get('settings-store')
        let hubUrl = ''
        if (settingsData?.['settings-store']) {
          const parsed = typeof settingsData['settings-store'] === 'string'
            ? JSON.parse(settingsData['settings-store'])
            : settingsData['settings-store']
          hubUrl = parsed?.state?.hubUrl || ''
        }

        if (!hubUrl) {
          sendResponse({ success: false, error: 'No Hub URL configured' })
          return
        }

        const refreshed = await tryRefreshHubToken({ hubUrl })
        if (refreshed) {
          const newToken = await getAccessToken()
          sendResponse({ success: true, token: newToken })
        } else {
          sendResponse({ success: false, error: 'Token refresh failed' })
        }
      } catch (err) {
        log.error('[Background] Failed to refresh access token:', err)
        sendResponse({ success: false, error: getErrorMessage(err) })
      }
    })()
    return true
  }

  /**
   * MEMORY_EXTRACTION - Extract memories from conversation
   */
  if (msg.type === 'MEMORY_EXTRACTION') {
    (async () => {
      const payload = parsePayload('MEMORY_EXTRACTION', msg.payload)
      if (!payload) {
        sendResponse({ success: false, error: 'Invalid extraction payload' })
        return
      }
      const response = await handleMemoryExtraction(payload)
      sendResponse(response)
    })()
    return true
  }

  /**
   * MEMORY_EMBEDDING - Generate embeddings for memories
   */
  if (msg.type === 'MEMORY_EMBEDDING') {
    (async () => {
      const payload = parsePayload('MEMORY_EMBEDDING', msg.payload)
      if (!payload) {
        sendResponse({ success: false, error: 'Invalid embedding payload' })
        return
      }
      const response = await handleEmbeddingGeneration(payload)
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
   * MEMORY_GET_PAGINATED - Get memories with pagination
   */
  if (msg.type === 'MEMORY_GET_PAGINATED') {
    (async () => {
      try {
        const payload = parsePayload('MEMORY_GET_PAGINATED', msg.payload)
        if (!payload) {
          sendResponse({ success: false, error: 'Invalid pagination options' })
          return
        }
        const result = await getMemoriesPaginated(payload)
        sendResponse({ success: true, ...result })
      } catch (err) {
        log.error('Failed to get paginated memories:', err)
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
   * MEMORY_ADD_WITH_DEDUP - Add memory with atomic deduplication
   * Prevents race conditions by checking for similar memories in background
   */
  if (msg.type === 'MEMORY_ADD_WITH_DEDUP') {
    (async () => {
      try {
        const payload = parsePayload('MEMORY_ADD_WITH_DEDUP', msg.payload)
        if (!payload) {
          sendResponse({ success: false, error: 'Invalid memory payload' })
          return
        }

        const { memory } = payload

        /** Check for existing similar memory atomically in background */
        const existing = await findSimilarMemory(memory.content, memory.type)

        if (existing) {
          /** Update existing memory with merged values */
          const updated = {
            ...existing,
            importance: Math.max(existing.importance, memory.importance),
            confidence: Math.max(existing.confidence, memory.confidence),
            lastAccessed: Date.now(),
            accessCount: existing.accessCount + 1,
          }
          await saveMemory(updated)
          log.log('[Background] Updated existing memory:', existing.id)
          sendResponse({ success: true, memory: updated, isNew: false })
        } else {
          /** Save new memory */
          await saveMemory(memory)

          /** Process entities for the new memory (non-blocking) */
          processMemoryEntities(memory).catch(err => {
            log.warn('[Background] Entity processing failed:', err)
          })

          log.log('[Background] Saved new memory:', memory.id)
          sendResponse({ success: true, memory, isNew: true })
        }
      } catch (err) {
        log.error('Failed to add memory with dedup:', err)
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

        /** Clean up entity links (non-blocking) */
        removeMemoryFromEntities(payload.id).catch(err => {
          log.warn('[Background] Entity cleanup failed:', err)
        })

        sendResponse({ success: true })
      } catch (err) {
        log.error('Failed to delete memory:', err)
        sendResponse({ success: false, error: getErrorMessage(err) })
      }
    })()
    return true
  }

  /**
   * MEMORY_DELETE_BATCH - Delete multiple memories by IDs
   */
  if (msg.type === 'MEMORY_DELETE_BATCH') {
    (async () => {
      try {
        const payload = parsePayload('MEMORY_DELETE_BATCH', msg.payload)
        if (!payload) {
          sendResponse({ success: false, error: 'Invalid memory IDs' })
          return
        }
        const count = await deleteMemories(payload.ids)

        /** Clean up entity links for all deleted memories (non-blocking) */
        Promise.all(payload.ids.map(id => removeMemoryFromEntities(id))).catch(err => {
          log.warn('[Background] Batch entity cleanup failed:', err)
        })

        sendResponse({ success: true, deleted: count })
      } catch (err) {
        log.error('Failed to delete memories:', err)
        sendResponse({ success: false, error: getErrorMessage(err) })
      }
    })()
    return true
  }

  /**
   * MEMORY_UPDATE - Update a memory by ID
   */
  if (msg.type === 'MEMORY_UPDATE') {
    (async () => {
      try {
        const payload = parsePayload('MEMORY_UPDATE', msg.payload)
        if (!payload) {
          sendResponse({ success: false, error: 'Invalid update payload' })
          return
        }
        await updateMemory(payload.id, payload.updates)
        sendResponse({ success: true })
      } catch (err) {
        log.error('Failed to update memory:', err)
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
   * ENTITY_GET_ALL - Get all entity links
   */
  if (msg.type === 'ENTITY_GET_ALL') {
    (async () => {
      try {
        const entities = await getAllEntityLinks()
        sendResponse({ success: true, entities })
      } catch (err) {
        log.error('Failed to get entities:', err)
        sendResponse({ success: false, error: getErrorMessage(err) })
      }
    })()
    return true
  }

  /**
   * ENTITY_GET_FOR_MEMORY - Get entities for a specific memory
   */
  if (msg.type === 'ENTITY_GET_FOR_MEMORY') {
    (async () => {
      try {
        const payload = parsePayload('ENTITY_GET_FOR_MEMORY', msg.payload)
        if (!payload) {
          sendResponse({ success: false, error: 'Invalid memory ID' })
          return
        }
        const entities = await getEntitiesForMemory(payload.memoryId)
        sendResponse({ success: true, entities })
      } catch (err) {
        log.error('Failed to get entities for memory:', err)
        sendResponse({ success: false, error: getErrorMessage(err) })
      }
    })()
    return true
  }

  /**
   * ENTITY_GET_RELATED_MEMORIES - Find related memories through shared entities
   */
  if (msg.type === 'ENTITY_GET_RELATED_MEMORIES') {
    (async () => {
      try {
        const payload = parsePayload('ENTITY_GET_RELATED_MEMORIES', msg.payload)
        if (!payload) {
          sendResponse({ success: false, error: 'Invalid request' })
          return
        }
        const relatedMemories = await findRelatedMemories(
          payload.memoryId,
          getAllMemories,
          payload.limit
        )
        sendResponse({ success: true, relatedMemories })
      } catch (err) {
        log.error('Failed to get related memories:', err)
        sendResponse({ success: false, error: getErrorMessage(err) })
      }
    })()
    return true
  }

  /**
   * ENTITY_PROCESS_MEMORY - Extract and store entities for a memory
   */
  if (msg.type === 'ENTITY_PROCESS_MEMORY') {
    (async () => {
      try {
        const payload = parsePayload('ENTITY_PROCESS_MEMORY', msg.payload)
        if (!payload) {
          sendResponse({ success: false, error: 'Invalid memory' })
          return
        }
        const entities = await processMemoryEntities(payload.memory)
        sendResponse({ success: true, entities })
      } catch (err) {
        log.error('Failed to process memory entities:', err)
        sendResponse({ success: false, error: getErrorMessage(err) })
      }
    })()
    return true
  }

  /**
   * ENTITY_GET_STATS - Get entity statistics
   */
  if (msg.type === 'ENTITY_GET_STATS') {
    (async () => {
      try {
        const stats = await getEntityStats()
        sendResponse({ success: true, stats })
      } catch (err) {
        log.error('Failed to get entity stats:', err)
        sendResponse({ success: false, error: getErrorMessage(err) })
      }
    })()
    return true
  }

  /**
   * SUMMARY_GENERATE - Generate a conversation summary via Hub API
   * NOTE: This is a placeholder - actual implementation requires Hub API endpoint
   */
  if (msg.type === 'SUMMARY_GENERATE') {
    (async () => {
      try {
        const payload = parsePayload('SUMMARY_GENERATE', msg.payload)
        if (!payload) {
          sendResponse({ success: false, error: 'Invalid summary request' })
          return
        }

        /** Extract key topics from conversation using simple keyword analysis */
        const allContent = payload.messages.map(m => m.content).join(' ')
        const words = allContent.toLowerCase().split(/\s+/)
        const wordFreq = new Map<string, number>()

        for (const word of words) {
          if (word.length > 4) {
            wordFreq.set(word, (wordFreq.get(word) || 0) + 1)
          }
        }

        const sortedWords = [...wordFreq.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, payload.maxTopics || 5)
          .map(([word]) => word)

        /** Generate simple summary from first and last user messages */
        const userMessages = payload.messages.filter(m => m.role === 'user')
        const firstMsg = userMessages[0]?.content.slice(0, 100) || ''
        const summary = `Conversation about: ${firstMsg}${firstMsg.length >= 100 ? '...' : ''}`

        sendResponse({
          success: true,
          summary: summary.slice(0, payload.maxLength || 500),
          keyTopics: sortedWords
        })
      } catch (err) {
        log.error('Failed to generate summary:', err)
        sendResponse({ success: false, error: getErrorMessage(err) })
      }
    })()
    return true
  }

  /**
   * SUMMARY_GET - Get a summary by conversation ID
   */
  if (msg.type === 'SUMMARY_GET') {
    (async () => {
      try {
        const payload = parsePayload('SUMMARY_GET', msg.payload)
        if (!payload) {
          sendResponse({ success: false, error: 'Invalid conversation ID' })
          return
        }
        const summary = await getSummaryByConversationId(payload.conversationId)
        sendResponse({ success: true, summary })
      } catch (err) {
        log.error('Failed to get summary:', err)
        sendResponse({ success: false, error: getErrorMessage(err) })
      }
    })()
    return true
  }

  /**
   * SUMMARY_GET_ALL - Get all summaries
   */
  if (msg.type === 'SUMMARY_GET_ALL') {
    (async () => {
      try {
        const summaries = await getAllSummaries()
        sendResponse({ success: true, summaries })
      } catch (err) {
        log.error('Failed to get all summaries:', err)
        sendResponse({ success: false, error: getErrorMessage(err) })
      }
    })()
    return true
  }

  /**
   * SUMMARY_GET_FOR_MEMORIES - Get summaries linked to specific memories
   */
  if (msg.type === 'SUMMARY_GET_FOR_MEMORIES') {
    (async () => {
      try {
        const payload = parsePayload('SUMMARY_GET_FOR_MEMORIES', msg.payload)
        if (!payload) {
          sendResponse({ success: false, error: 'Invalid memory IDs' })
          return
        }
        const summaries = await getSummariesForMemories(payload.memoryIds)
        sendResponse({ success: true, summaries })
      } catch (err) {
        log.error('Failed to get summaries for memories:', err)
        sendResponse({ success: false, error: getErrorMessage(err) })
      }
    })()
    return true
  }

  /**
   * SUMMARY_SAVE - Save a conversation summary
   */
  if (msg.type === 'SUMMARY_SAVE') {
    (async () => {
      try {
        const payload = parsePayload('SUMMARY_SAVE', msg.payload)
        if (!payload) {
          sendResponse({ success: false, error: 'Invalid summary' })
          return
        }
        await saveSummary(payload.summary)
        sendResponse({ success: true })
      } catch (err) {
        log.error('Failed to save summary:', err)
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

/**
 * TTL Cleanup - Run memory expiration cleanup every hour
 */
const TTL_CLEANUP_INTERVAL_MS = 60 * 60 * 1000

setInterval(async () => {
  try {
    const deleted = await cleanupExpiredMemories()
    if (deleted > 0) {
      log.log(`[Background] TTL cleanup removed ${deleted} expired memories`)
    }
  } catch (err) {
    log.error('[Background] TTL cleanup failed:', err)
  }
}, TTL_CLEANUP_INTERVAL_MS)

/** Run initial cleanup on startup */
cleanupExpiredMemories().catch(err => {
  log.error('[Background] Initial TTL cleanup failed:', err)
})
