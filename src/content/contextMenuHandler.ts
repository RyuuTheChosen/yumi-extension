/**
 * Context Menu Handler
 *
 * Tracks right-clicked elements and handles context menu messages from the background script.
 * Provides content to the chat overlay for user-driven page reading.
 */

import { createLogger } from '../lib/core/debug'

const log = createLogger('ContextMenu')

// Track the last right-clicked element
let lastRightClickedElement: Element | null = null

// Track right-clicks to capture target element
document.addEventListener(
  'contextmenu',
  (e) => {
    lastRightClickedElement = e.target as Element
  },
  true
)

/**
 * Extract readable text content from an element.
 * Expands to parent if content is too short.
 */
function extractElementContent(el: Element): string {
  const htmlEl = el as HTMLElement

  // Get element's visible text content
  let text = htmlEl.innerText || el.textContent || ''

  // If too short, try parent element for more context
  if (text.trim().length < 50 && el.parentElement) {
    const parentText = (el.parentElement as HTMLElement).innerText || el.parentElement.textContent || ''
    if (parentText.length > text.length) {
      text = parentText
    }
  }

  // If still too short, try going up one more level (useful for tweets, cards, etc.)
  if (text.trim().length < 100 && el.parentElement?.parentElement) {
    const grandparentText =
      (el.parentElement.parentElement as HTMLElement).innerText ||
      el.parentElement.parentElement.textContent ||
      ''
    if (grandparentText.length > text.length && grandparentText.length < 10000) {
      text = grandparentText
    }
  }

  // Clean up and truncate
  return text.trim().slice(0, 5000)
}

/**
 * Dispatch a custom event to open chat with context.
 * The ChatOverlay listens for this event.
 */
function openChatWithContext(text: string, source: 'selection' | 'element') {
  const event = new CustomEvent('yumi:open-with-context', {
    detail: { text, source },
  })
  window.dispatchEvent(event)
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'CONTEXT_MENU_SELECTION') {
    const text = msg.payload?.text
    if (text) {
      log.log('Selection received:', text.slice(0, 100) + '...')
      openChatWithContext(text, 'selection')
    }
    sendResponse({ success: true })
    return true
  }

  if (msg.type === 'CONTEXT_MENU_READ_ELEMENT') {
    if (lastRightClickedElement) {
      const text = extractElementContent(lastRightClickedElement)
      if (text) {
        log.log('Element content extracted:', text.slice(0, 100) + '...')
        openChatWithContext(text, 'element')
      } else {
        log.warn('No content found in clicked element')
      }
    } else {
      log.warn('No element tracked from right-click')
    }
    sendResponse({ success: true })
    return true
  }

  // Let other handlers process unknown messages
  return false
})

log.log('Handler initialized')

export {}
