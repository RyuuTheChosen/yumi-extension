/**
 * Core Page Context Extraction
 *
 * Extracts intelligent context from web pages at various levels:
 * - Level 0: Basic (URL, title) - always free
 * - Level 1: Type detection + metadata - lightweight
 * - Level 2: Main content extraction - medium cost
 * - Level 3: Deep/site-specific - heavy
 */

import type {
  PageContext,
  PageMetadata,
  PageStructure,
  PageType,
  ExtractionOptions,
  DetectionSignal,
} from './types'
import {
  DEFAULT_EXTRACTION_OPTIONS,
  CONTENT_LIMITS,
  DEFAULT_PRIVACY_SETTINGS,
} from './types'

/**
 * Main extraction function - extracts page context at specified level
 */
export async function extractPageContext(
  options: Partial<ExtractionOptions> = {}
): Promise<PageContext> {
  const opts = { ...DEFAULT_EXTRACTION_OPTIONS, ...options }
  const startTime = performance.now()

  try {
    // Level 0: Basic context (always extracted)
    const basic = extractBasicContext()

    // Check privacy blacklist
    if (isBlacklisted(basic.origin)) {
      return {
        ...basic,
        type: 'other',
        metadata: { title: basic.title },
        confidence: 0,
        extractedAt: Date.now(),
        extractionLevel: 0,
      }
    }

    if (opts.level === 0) {
      return {
        ...basic,
        type: 'other',
        metadata: { title: basic.title },
        confidence: 0,
        extractedAt: Date.now(),
        extractionLevel: 0,
      }
    }

    // Level 1: Type detection + metadata
    const metadata = extractMetadata()
    const { type, confidence } = detectPageType(basic.url, document)

    if (opts.level === 1) {
      return {
        ...basic,
        type,
        metadata,
        confidence,
        extractedAt: Date.now(),
        extractionLevel: 1,
      }
    }

    // Level 2: Content extraction
    const mainContent = extractMainContent(opts.maxContentLength || CONTENT_LIMITS.maxMainContent)
    const summary = extractSummary(metadata, mainContent)
    const structure = opts.includeStructure ? extractStructure() : undefined

    const context: PageContext = {
      ...basic,
      type,
      metadata,
      confidence,
      mainContent,
      summary,
      structure,
      extractedAt: Date.now(),
      extractionLevel: opts.level >= 3 ? 3 : 2,
    }

    const elapsed = performance.now() - startTime
    console.log(`[Context] Extracted level ${opts.level} in ${elapsed.toFixed(0)}ms`)

    return context
  } catch (error) {
    console.error('[Context] Extraction failed:', error)
    // Return minimal context on error
    return {
      url: window.location.href,
      origin: window.location.origin,
      pathname: window.location.pathname,
      title: document.title || '',
      type: 'other',
      metadata: { title: document.title || '' },
      confidence: 0,
      extractedAt: Date.now(),
      extractionLevel: 0,
    }
  }
}

/**
 * Extract basic context (Level 0) - URL and title
 */
function extractBasicContext(): Pick<PageContext, 'url' | 'origin' | 'pathname' | 'title'> {
  return {
    url: window.location.href,
    origin: window.location.origin,
    pathname: window.location.pathname,
    title: document.title || '',
  }
}

/**
 * Extract metadata from meta tags
 */
function extractMetadata(): PageMetadata {
  const getMeta = (name: string): string | undefined => {
    const el = document.querySelector(
      `meta[name="${name}"], meta[property="${name}"], meta[property="og:${name}"]`
    )
    return el?.getAttribute('content') || undefined
  }

  const getMetaArray = (name: string): string[] | undefined => {
    const content = getMeta(name)
    if (!content) return undefined
    return content.split(',').map(s => s.trim()).filter(Boolean)
  }

  return {
    title: document.title || '',
    description: getMeta('description') || getMeta('og:description'),
    author: getMeta('author') || getMeta('article:author'),
    publishedDate: getMeta('article:published_time') || getMeta('datePublished'),
    modifiedDate: getMeta('article:modified_time') || getMeta('dateModified'),
    language: document.documentElement.lang || getMeta('language'),
    keywords: getMetaArray('keywords'),
    image: getMeta('og:image') || getMeta('twitter:image'),
    siteName: getMeta('og:site_name'),
  }
}

/**
 * Extract main content from the page
 */
function extractMainContent(maxLength: number): string {
  const mainElement = findMainContentElement()
  if (!mainElement) {
    // Fallback to body with basic cleaning
    return cleanText(document.body?.innerText || '').slice(0, maxLength)
  }

  const text = cleanText((mainElement as HTMLElement).innerText || mainElement.textContent || '')
  return text.slice(0, maxLength)
}

/**
 * Find the main content element using common patterns
 */
function findMainContentElement(): Element | null {
  const selectors = [
    'main',
    'article',
    '[role="main"]',
    '#main-content',
    '#main',
    '#content',
    '.post-content',
    '.article-content',
    '.entry-content',
    '.content-body',
    '.post-body',
    '.markdown-body',  // GitHub
    '.question',        // Stack Overflow
    '.product-main',    // E-commerce
  ]

  for (const selector of selectors) {
    const el = document.querySelector(selector)
    if (el && (el.textContent?.length || 0) > 200) {
      return el
    }
  }

  // Fallback: find largest text block
  return findLargestTextBlock()
}

/**
 * Find the element with the most text content
 */
function findLargestTextBlock(): Element | null {
  const candidates = document.querySelectorAll('div, section, article')
  let largest: Element | null = null
  let largestLength = 0

  for (const el of Array.from(candidates)) {
    // Skip elements that are likely navigation/footer
    if (isLikelyNonContent(el)) continue

    const length = el.textContent?.length || 0
    if (length > largestLength && length > 500) {
      largestLength = length
      largest = el
    }
  }

  return largest
}

/**
 * Check if element is likely non-content (nav, footer, etc.)
 */
function isLikelyNonContent(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  if (['nav', 'footer', 'header', 'aside'].includes(tag)) return true

  const className = el.className?.toLowerCase() || ''
  const id = el.id?.toLowerCase() || ''

  const nonContentPatterns = [
    'nav', 'menu', 'sidebar', 'footer', 'header', 'banner',
    'advertisement', 'ad-', 'social', 'share', 'comment',
    'related', 'recommended', 'cookie', 'popup', 'modal',
  ]

  return nonContentPatterns.some(p => className.includes(p) || id.includes(p))
}

/**
 * Clean extracted text
 */
function cleanText(text: string): string {
  return text
    .replace(/\s+/g, ' ')           // Normalize whitespace
    .replace(/\n{3,}/g, '\n\n')     // Max 2 newlines
    .replace(/\t/g, ' ')            // Replace tabs
    .trim()
}

/**
 * Extract a summary from metadata or content
 */
function extractSummary(metadata: PageMetadata, content: string): string {
  // Prefer meta description
  if (metadata.description && metadata.description.length > 50) {
    return metadata.description
  }

  // Fall back to first paragraph
  const firstParagraph = content.split('\n\n')[0]
  if (firstParagraph && firstParagraph.length > 50) {
    return firstParagraph.slice(0, 300) + (firstParagraph.length > 300 ? '...' : '')
  }

  return content.slice(0, 300) + (content.length > 300 ? '...' : '')
}

/**
 * Extract page structure (headings, links, etc.)
 */
function extractStructure(): PageStructure {
  // Headings
  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4'))
    .slice(0, CONTENT_LIMITS.maxHeadings)
    .map(el => ({
      level: parseInt(el.tagName[1]),
      text: el.textContent?.trim() || '',
    }))
    .filter(h => h.text.length > 0)

  // Links
  const currentOrigin = window.location.origin
  const links = Array.from(document.querySelectorAll('a[href]'))
    .slice(0, CONTENT_LIMITS.maxLinks)
    .map(el => {
      const href = el.getAttribute('href') || ''
      let isExternal = false
      try {
        const url = new URL(href, window.location.href)
        isExternal = url.origin !== currentOrigin
      } catch {
        // Invalid URL, assume internal
      }
      return {
        text: el.textContent?.trim() || '',
        href,
        isExternal,
      }
    })
    .filter(l => l.text.length > 0 && l.href.length > 0)

  // Images
  const images = Array.from(document.querySelectorAll('img[src]'))
    .slice(0, 20)
    .map(el => ({
      src: el.getAttribute('src') || '',
      alt: el.getAttribute('alt') || undefined,
    }))
    .filter(i => i.src.length > 0)

  // Code blocks
  const codeBlocks = Array.from(document.querySelectorAll('pre code, pre'))
    .slice(0, CONTENT_LIMITS.maxCodeBlocks)
    .map(el => {
      const language = el.className?.match(/language-(\w+)/)?.[1] ||
                       el.getAttribute('data-language') ||
                       undefined
      return {
        language,
        content: el.textContent?.slice(0, 500) || '',
      }
    })
    .filter(c => c.content.length > 0)

  return {
    headings,
    links,
    images,
    codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
  }
}

/**
 * Detect page type using multiple signals
 */
export function detectPageType(
  url: string,
  doc: Document
): { type: PageType; confidence: number } {
  const signals: DetectionSignal[] = [
    ...detectFromUrl(url),
    ...detectFromMeta(doc),
    ...detectFromStructure(doc),
  ]

  return combineSignals(signals)
}

/**
 * URL-based page type detection
 */
function detectFromUrl(url: string): DetectionSignal[] {
  const signals: DetectionSignal[] = []

  const patterns: Record<PageType, RegExp[]> = {
    code: [
      /github\.com\/[\w-]+\/[\w-]+/,
      /gitlab\.com\/[\w-]+\/[\w-]+/,
      /bitbucket\.org/,
      /codepen\.io/,
      /codesandbox\.io/,
      /replit\.com/,
    ],
    documentation: [
      /docs\./,
      /\/docs\//,
      /documentation/,
      /readme\.io/,
      /gitbook\.io/,
      /devdocs\.io/,
      /developer\./,
      /\/api\//,
    ],
    forum: [
      /stackoverflow\.com\/questions/,
      /reddit\.com\/r\//,
      /discourse/,
      /\.stackexchange\.com/,
      /community\./,
      /forum\./,
    ],
    shopping: [
      /amazon\.(com|co\.|de|fr|uk|jp)/,
      /ebay\./,
      /walmart\./,
      /target\./,
      /bestbuy\./,
      /\/product\//,
      /\/shop\//,
      /\/item\//,
    ],
    video: [
      /youtube\.com\/watch/,
      /youtu\.be\//,
      /vimeo\.com\/\d+/,
      /twitch\.tv/,
      /dailymotion\.com/,
    ],
    social: [
      /twitter\.com/,
      /x\.com/,
      /facebook\.com/,
      /linkedin\.com/,
      /instagram\.com/,
    ],
    search: [
      /google\.\w+\/search/,
      /bing\.com\/search/,
      /duckduckgo\.com/,
      /search\./,
    ],
    email: [
      /mail\.google\.com/,
      /outlook\.(live|office)\.com/,
      /mail\./,
    ],
    chat: [
      /slack\.com/,
      /discord\.com/,
      /teams\.microsoft\.com/,
    ],
    article: [],
    dashboard: [/dashboard/, /analytics/, /admin/],
    form: [/signup/, /register/, /checkout/, /login/],
    landing: [],
    other: [],
  }

  for (const [type, regexes] of Object.entries(patterns) as [PageType, RegExp[]][]) {
    for (const regex of regexes) {
      if (regex.test(url)) {
        signals.push({ source: 'url', type, confidence: 0.8 })
        break
      }
    }
  }

  return signals
}

/**
 * Meta tag-based page type detection
 */
function detectFromMeta(doc: Document): DetectionSignal[] {
  const signals: DetectionSignal[] = []

  // OpenGraph type
  const ogType = doc.querySelector('meta[property="og:type"]')?.getAttribute('content')
  if (ogType === 'article') signals.push({ source: 'meta', type: 'article', confidence: 0.8 })
  if (ogType === 'product') signals.push({ source: 'meta', type: 'shopping', confidence: 0.8 })
  if (ogType === 'video') signals.push({ source: 'meta', type: 'video', confidence: 0.8 })
  if (ogType === 'website') signals.push({ source: 'meta', type: 'landing', confidence: 0.3 })

  // Schema.org types
  const schemaScripts = doc.querySelectorAll('script[type="application/ld+json"]')
  for (const script of Array.from(schemaScripts)) {
    try {
      const data = JSON.parse(script.textContent || '')
      const schemaType = data['@type']
      if (schemaType === 'Article' || schemaType === 'NewsArticle' || schemaType === 'BlogPosting') {
        signals.push({ source: 'meta', type: 'article', confidence: 0.9 })
      }
      if (schemaType === 'Product') {
        signals.push({ source: 'meta', type: 'shopping', confidence: 0.9 })
      }
      if (schemaType === 'VideoObject') {
        signals.push({ source: 'meta', type: 'video', confidence: 0.9 })
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  return signals
}

/**
 * DOM structure-based page type detection
 */
function detectFromStructure(doc: Document): DetectionSignal[] {
  const signals: DetectionSignal[] = []

  // Code indicators
  const codeBlockCount = doc.querySelectorAll('pre code').length
  if (codeBlockCount > 3) {
    signals.push({ source: 'structure', type: 'code', confidence: 0.6 })
  }
  if (codeBlockCount > 0 && codeBlockCount <= 3) {
    signals.push({ source: 'structure', type: 'documentation', confidence: 0.4 })
  }

  // Article indicators
  if (doc.querySelector('article') && doc.querySelector('time[datetime]')) {
    signals.push({ source: 'structure', type: 'article', confidence: 0.7 })
  }

  // Shopping indicators
  const hasPrice = !!doc.querySelector('[class*="price"], [data-price], .price')
  const hasAddToCart = !!doc.querySelector('[class*="add-to-cart"], [class*="buy"], .buy-button')
  if (hasPrice && hasAddToCart) {
    signals.push({ source: 'structure', type: 'shopping', confidence: 0.7 })
  }

  // Video indicators
  if (doc.querySelector('video') || doc.querySelector('[class*="player"]')) {
    signals.push({ source: 'structure', type: 'video', confidence: 0.6 })
  }

  // Forum indicators
  const hasComments = !!doc.querySelector('[class*="comment"], [id*="comment"], .comments')
  const hasVotes = !!doc.querySelector('[class*="vote"], [class*="upvote"]')
  if (hasComments && hasVotes) {
    signals.push({ source: 'structure', type: 'forum', confidence: 0.6 })
  }

  // Form indicators
  const formCount = doc.querySelectorAll('form').length
  const inputCount = doc.querySelectorAll('input').length
  if (formCount > 0 && inputCount > 3) {
    signals.push({ source: 'structure', type: 'form', confidence: 0.5 })
  }

  return signals
}

/**
 * Combine detection signals into final result
 */
function combineSignals(signals: DetectionSignal[]): { type: PageType; confidence: number } {
  if (signals.length === 0) {
    return { type: 'other', confidence: 0 }
  }

  // Group and weight by type
  const scoresByType = new Map<PageType, number>()
  const weights = { url: 1.2, meta: 1.0, structure: 0.8, content: 0.6 }

  for (const signal of signals) {
    const current = scoresByType.get(signal.type) || 0
    const weight = weights[signal.source]
    scoresByType.set(signal.type, current + signal.confidence * weight)
  }

  // Find highest scoring type
  let bestType: PageType = 'other'
  let bestScore = 0

  for (const [type, score] of scoresByType) {
    if (score > bestScore) {
      bestType = type
      bestScore = score
    }
  }

  // Normalize confidence to 0-1
  const confidence = Math.min(bestScore / 2, 1)

  return { type: bestType, confidence }
}

/**
 * Check if URL is blacklisted for privacy
 */
function isBlacklisted(origin: string): boolean {
  return DEFAULT_PRIVACY_SETTINGS.siteBlacklist.some(pattern =>
    origin.toLowerCase().includes(pattern.toLowerCase())
  )
}

/**
 * Redact sensitive content from text
 */
export function redactSensitiveContent(text: string): string {
  let result = text
  for (const pattern of DEFAULT_PRIVACY_SETTINGS.sensitivePatterns) {
    result = result.replace(pattern, '[REDACTED]')
  }
  return result
}

/**
 * Build a concise context string for AI prompts
 */
export function buildContextForPrompt(context: PageContext, maxLength: number = CONTENT_LIMITS.maxPromptContext): string {
  const parts: string[] = []

  // Basic info
  parts.push(`Page: ${context.title}`)
  parts.push(`Type: ${context.type}`)

  // Summary if available
  if (context.summary) {
    parts.push(`Summary: ${context.summary.slice(0, 200)}`)
  }

  // Main content (truncated)
  if (context.mainContent) {
    const contentBudget = maxLength - parts.join('\n').length - 100
    if (contentBudget > 100) {
      const truncated = context.mainContent.slice(0, contentBudget)
      parts.push(`\nContent:\n${truncated}${context.mainContent.length > contentBudget ? '...' : ''}`)
    }
  }

  return parts.join('\n').slice(0, maxLength)
}
