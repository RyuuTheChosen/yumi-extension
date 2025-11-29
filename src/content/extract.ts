/**
 * Content Extraction Utilities
 *
 * This module provides backward-compatible wrappers around the new
 * context extraction system in lib/context/.
 */

import { useContextStore, extractPageContext } from '../lib/context'
import type { PageContext } from '../lib/context'

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
 * Get page context for chat messages
 */
export async function getPageContextForChat(): Promise<{
  url: string
  title: string
  pageType: string
  content?: string
}> {
  try {
    const context = await extractPageContext({ level: 2 })
    return {
      url: context.url,
      title: context.title,
      pageType: context.type,
      content: context.mainContent?.slice(0, 5000),
    }
  } catch (error) {
    console.error('[Extract] Failed to get context:', error)
    return {
      url: window.location.href,
      title: document.title,
      pageType: 'other',
    }
  }
}

/**
 * Re-export from context module for convenience
 */
export { extractPageContext } from '../lib/context'
export type { PageContext } from '../lib/context'
