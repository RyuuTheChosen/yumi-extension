/**
 * Context Awareness Type Definitions
 *
 * Enables Yumi to understand what the user is looking at and provide
 * intelligent, contextual assistance.
 */

/**
 * Classification of page types for context-aware responses
 */
export type PageType =
  | 'article'        // News, blog posts
  | 'documentation'  // Docs, API references
  | 'code'           // GitHub, GitLab, code files
  | 'forum'          // Stack Overflow, Reddit, forums
  | 'shopping'       // E-commerce product pages
  | 'social'         // Twitter, Facebook, LinkedIn
  | 'video'          // YouTube, Vimeo
  | 'search'         // Google, Bing search results
  | 'email'          // Gmail, Outlook web
  | 'chat'           // Slack, Discord web
  | 'dashboard'      // Analytics, admin panels
  | 'form'           // Signup, checkout forms
  | 'landing'        // Marketing/landing pages
  | 'other'          // Uncategorized

/**
 * Metadata extracted from page meta tags
 */
export interface PageMetadata {
  title: string
  description?: string
  author?: string
  publishedDate?: string
  modifiedDate?: string
  language?: string
  keywords?: string[]
  image?: string
  siteName?: string
}

/**
 * Structural elements extracted from the page
 */
export interface PageStructure {
  headings: Array<{ level: number; text: string }>
  links: Array<{ text: string; href: string; isExternal: boolean }>
  images: Array<{ src: string; alt?: string }>
  codeBlocks?: Array<{ language?: string; content: string }>
  lists?: string[][]
}

/**
 * Complete page context at various extraction levels
 */
export interface PageContext {
  // Level 0: Always available (free)
  url: string
  origin: string
  pathname: string
  title: string

  // Level 1: Lightweight detection
  type: PageType
  metadata: PageMetadata
  confidence: number  // How confident in type detection (0-1)

  // Level 2: Content extraction
  mainContent?: string           // Cleaned main text
  summary?: string               // Meta description or first paragraph
  structure?: PageStructure

  // Level 3: Deep/site-specific
  siteSpecific?: SiteSpecificData

  // Meta
  extractedAt: number
  extractionLevel: 0 | 1 | 2 | 3
}

/**
 * Site-specific extracted data
 */
export interface SiteSpecificData {
  type: string
  data: Record<string, unknown>
}

/**
 * Options for controlling extraction behavior
 */
export interface ExtractionOptions {
  level: 0 | 1 | 2 | 3
  maxContentLength?: number      // Default 10000 chars
  includeStructure?: boolean     // Include headings, links, etc.
  timeout?: number               // Default 5000ms
}

/**
 * Default extraction options
 */
export const DEFAULT_EXTRACTION_OPTIONS: ExtractionOptions = {
  level: 2,
  maxContentLength: 10000,
  includeStructure: true,
  timeout: 5000,
}

/**
 * Content limits for extraction
 */
export const CONTENT_LIMITS = {
  maxMainContent: 10000,       // chars
  maxSiteSpecificData: 5000,   // chars (serialized)
  maxHeadings: 20,
  maxLinks: 50,
  maxCodeBlocks: 10,
  maxPromptContext: 3000,      // chars in system prompt
}

/**
 * Cache configuration
 */
export const CACHE_CONFIG = {
  contextMaxAge: 5 * 60 * 1000,       // 5 minutes
  pageTypeMaxAge: 60 * 1000,          // 1 minute
  siteSpecificMaxAge: 5 * 60 * 1000,  // 5 minutes
  maxCachedUrls: 50,                  // LRU eviction
}

/**
 * Privacy settings for context extraction
 */
export interface ContextPrivacySettings {
  enabled: boolean                    // Master toggle
  extractContent: boolean             // Extract main content
  trackActivity: boolean              // Track user activity
  siteBlacklist: string[]             // Never extract from these
  sensitivePatterns: RegExp[]         // Redact matching content
}

/**
 * Default privacy settings (privacy-first)
 */
export const DEFAULT_PRIVACY_SETTINGS: ContextPrivacySettings = {
  enabled: true,
  extractContent: true,
  trackActivity: false,               // Opt-in only
  siteBlacklist: [
    'mail.google.com',
    'outlook.live.com',
    'banking',
    'health',
    'paypal.com',
  ],
  sensitivePatterns: [
    /password/i,
    /credit.?card/i,
    /\bssn\b/i,
    /social.?security/i,
  ],
}

/**
 * Context store state interface
 */
export interface ContextState {
  // Current page context
  currentContext: PageContext | null
  isExtracting: boolean
  lastError: string | null

  // Settings
  autoExtractLevel: 0 | 1 | 2
  privacySettings: ContextPrivacySettings

  // Actions
  extract: (options?: Partial<ExtractionOptions>) => Promise<PageContext>
  getContext: () => PageContext | null
  clearCache: () => void
  invalidateUrl: (url: string) => void
  setAutoExtractLevel: (level: 0 | 1 | 2) => void
  updatePrivacySettings: (settings: Partial<ContextPrivacySettings>) => void
}

/**
 * Detection signal from various sources
 */
export interface DetectionSignal {
  source: 'url' | 'meta' | 'structure' | 'content'
  type: PageType
  confidence: number
}
