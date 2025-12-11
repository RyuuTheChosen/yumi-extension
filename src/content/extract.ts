/**
 * Content Extraction Utilities
 *
 * This module provides backward-compatible wrappers around the new
 * context extraction system in lib/context/.
 */

import { useContextStore, extractPageContext } from '../lib/context'
import type { PageContext } from '../lib/context'
import { createLogger } from '../lib/core/debug'

const log = createLogger('Extract')

/**
 * Extract main content from the current page
 * @deprecated Use extractPageContext() from lib/context instead
 */
export function extractMainContent(doc: Document = document): string {
  // Try to get from store first (cached)
  const cached = useContextStore.getState().currentContext
  if (cached?.mainContent) {
    return cached.mainContent
  }

  // Fallback: extract synchronously from DOM
  const mainElement = findMainElement(doc)
  return mainElement?.innerText || doc.body?.innerText || ''
}

/**
 * Find the main content element
 */
function findMainElement(doc: Document): HTMLElement | null {
  const selectors = [
    'main',
    'article',
    '[role="main"]',
    '#main-content',
    '#content',
    '.post-content',
    '.article-content',
    '.markdown-body',
  ]

  for (const selector of selectors) {
    const el = doc.querySelector(selector) as HTMLElement | null
    if (el && (el.textContent?.length || 0) > 200) {
      return el
    }
  }

  return doc.body
}

/**
 * Re-export from context module for convenience
 */
export { extractPageContext } from '../lib/context'
export type { PageContext } from '../lib/context'
