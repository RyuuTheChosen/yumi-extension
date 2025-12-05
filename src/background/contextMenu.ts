/**
 * Context Menu Module
 *
 * Handles right-click context menu creation and click events.
 * Provides menu items for image analysis, text selection, and page reading.
 */

import { createLogger } from '../lib/debug'
import { CONTEXT_MENU_IDS, MESSAGE_TYPES } from '../lib/constants'
import { getErrorMessage } from '../lib/errors'

const log = createLogger('ContextMenu')

/**
 * Initialize context menus
 *
 * Creates right-click menu items for:
 * - Image analysis ("Ask Yumi about this image")
 * - Text selection ("Ask Yumi about this")
 * - Page element reading ("Let Yumi read this")
 */
export function initializeContextMenus(): void {
  log.log('[ContextMenu] Initializing context menus')

  // Create context menu for image analysis
  chrome.contextMenus.create({
    id: CONTEXT_MENU_IDS.ANALYZE_IMAGE,
    title: 'Ask Yumi about this image',
    contexts: ['image'],
  })

  // Context menu for selected text
  chrome.contextMenus.create({
    id: CONTEXT_MENU_IDS.ANALYZE_SELECTION,
    title: 'Ask Yumi about this',
    contexts: ['selection'],
  })

  // Context menu for any element (fallback for reading page content)
  chrome.contextMenus.create({
    id: CONTEXT_MENU_IDS.READ_ELEMENT,
    title: 'Let Yumi read this',
    contexts: ['page', 'frame', 'link'],
  })

  log.log('[ContextMenu] Context menus created')
}

/**
 * Handle context menu click events
 *
 * Routes menu item clicks to appropriate message handlers
 */
export function setupContextMenuHandlers(): void {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return

    // Handle image analysis
    if (info.menuItemId === CONTEXT_MENU_IDS.ANALYZE_IMAGE && info.srcUrl) {
      chrome.tabs.sendMessage(tab.id, {
        type: MESSAGE_TYPES.ANALYZE_IMAGE,
        payload: { imageUrl: info.srcUrl },
      }).catch((err) => {
        log.warn('[ContextMenu] Failed to send ANALYZE_IMAGE to content script:', getErrorMessage(err))
      })
    }

    // Handle selected text
    if (info.menuItemId === CONTEXT_MENU_IDS.ANALYZE_SELECTION && info.selectionText) {
      chrome.tabs.sendMessage(tab.id, {
        type: MESSAGE_TYPES.CONTEXT_MENU_SELECTION,
        payload: { text: info.selectionText },
      }).catch((err) => {
        log.warn('[ContextMenu] Failed to send CONTEXT_MENU_SELECTION to content script:', getErrorMessage(err))
      })
    }

    // Handle element reading (triggers content script to read last right-clicked element)
    if (info.menuItemId === CONTEXT_MENU_IDS.READ_ELEMENT) {
      chrome.tabs.sendMessage(tab.id, {
        type: MESSAGE_TYPES.CONTEXT_MENU_READ_ELEMENT,
        payload: {},
      }).catch((err) => {
        log.warn('[ContextMenu] Failed to send CONTEXT_MENU_READ_ELEMENT to content script:', getErrorMessage(err))
      })
    }
  })

  log.log('[ContextMenu] Context menu handlers registered')
}
