/**
 * Background Service Worker (MV3)
 *
 * Entry point for background script that orchestrates all background modules.
 * Handles Chrome extension lifecycle and routes messages to appropriate handlers.
 */

import { createLogger } from '../lib/debug'
import { setupExternalMessaging } from './externalMessaging'
import { initializeContextMenus, setupContextMenuHandlers } from './contextMenu'
import { initializePortHandlers } from './portManager'
import { handleMemoryExtraction } from './memory'
import { AUDIO } from '../lib/constants'
import { getErrorMessage } from '../lib/errors'
import type { RuntimeMessage } from '../types'

const log = createLogger('Background')

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
})

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

  return false
})

log.log('[Background] Service worker initialized')
