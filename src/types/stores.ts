/**
 * Store Type Definitions
 *
 * Comprehensive type definitions for all Zustand stores used throughout the extension.
 * Replaces `any` types with proper interfaces for type safety.
 */

import type { StateCreator, StoreMutatorIdentifier } from 'zustand'

/**
 * Settings store state
 */
export interface SettingsState {
  // Hub connection
  hubUrl: string
  hubToken: string | null

  // User info
  userId: string | null
  userEmail: string | null

  // Companion settings
  activeCompanionSlug: string

  // Feature toggles
  showAvatar: boolean
  enableMemory: boolean
  enableVision: boolean
  enableTTS: boolean
  enableSTT: boolean

  // Audio settings
  ttsVolume: number

  // Advanced settings
  debugMode: boolean
}

/**
 * Settings store interface with methods
 */
export interface SettingsStore extends SettingsState {
  getState: () => SettingsState
  setState: (partial: Partial<SettingsState>) => void
  subscribe: (listener: (state: SettingsState) => void) => () => void

  // Actions
  setHubUrl: (url: string) => void
  setHubToken: (token: string | null) => void
  setActiveCompanion: (slug: string) => void
  toggleAvatar: () => void
  toggleMemory: () => void
  toggleVision: () => void
  toggleTTS: () => void
  setTTSVolume: (volume: number) => void
  reset: () => void
}

/**
 * Chat status for streaming state
 */
export type ChatStatus = 'idle' | 'sending' | 'streaming' | 'error' | 'canceled'

/**
 * Chat message interface
 * Note: Uses `ts` for timestamp to match IndexedDB schema in db.ts
 */
export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  ts: number
  scopeId: string
  streaming?: boolean
  sources?: SearchSource[]
  status?: 'final' | 'streaming' | 'error'
  meta?: {
    url?: string
    title?: string
    tabId?: number
    tokensIn?: number
    tokensOut?: number
    model?: string
    proactive?: boolean
  }
}

/**
 * Search source for messages with web search results
 */
export interface SearchSource {
  title: string
  url: string
  snippet: string
}

/**
 * Chat scope (per-origin conversation thread)
 */
export interface ChatScope {
  id: string
  origin: string
  title: string
  lastActive: number
}

/**
 * Chat store state
 */
export interface ChatState {
  // Current scope
  currentScope: ChatScope

  // Messages for current scope
  messages: Message[]

  // Streaming state
  streamingMessage: Message | null
  isStreaming: boolean

  // Request management
  activeRequestId: string | null
  cancelActive: (() => void) | null
}

/**
 * Chat store interface with methods
 */
export interface ChatStore extends ChatState {
  getState: () => ChatState
  setState: (partial: Partial<ChatState>) => void
  subscribe: (listener: (state: ChatState) => void) => () => void

  // Actions
  addMessage: (message: Message) => void
  updateMessage: (id: string, updates: Partial<Message>) => void
  deleteMessage: (id: string) => void
  clearMessages: () => void
  setStreamingMessage: (message: Message | null) => void
  setIsStreaming: (isStreaming: boolean) => void
  setActiveRequest: (requestId: string | null, cancel: (() => void) | null) => void
  cancelCurrentRequest: () => void
}

/**
 * Memory store state
 */
export interface MemoryState {
  memories: Memory[]
  isExtracting: boolean
  lastExtraction: number | null
}

/**
 * Memory interface
 */
export interface Memory {
  id: string
  type: 'identity' | 'preference' | 'skill' | 'project' | 'person' | 'event' | 'opinion'
  content: string
  importance: number
  confidence: number
  timestamp: number
  source?: string
}

/**
 * Memory store interface with methods
 */
export interface MemoryStore extends MemoryState {
  getState: () => MemoryState
  setState: (partial: Partial<MemoryState>) => void
  subscribe: (listener: (state: MemoryState) => void) => () => void

  // Actions
  addMemory: (memory: Memory) => void
  addMemories: (memories: Memory[]) => void
  updateMemory: (id: string, updates: Partial<Memory>) => void
  deleteMemory: (id: string) => void
  clearMemories: () => void
  setIsExtracting: (isExtracting: boolean) => void
  setLastExtraction: (timestamp: number) => void
  getMemoriesByType: (type: Memory['type']) => Memory[]
  searchMemories: (query: string) => Memory[]
}

/**
 * Personality object (companion configuration)
 */
export interface Personality {
  id: string
  name: string
  traits: string[]
  systemPrompt: string
  voice?: {
    provider: string
    voiceId: string
    speed: number
  }
  expressions?: Record<string, string>
  capabilities?: {
    plugins: string[]
  }
  examples?: string
}

/**
 * Personality store state
 */
export interface PersonalityState {
  activeId: string | null
  list: Personality[]
}

/**
 * Personality store interface
 */
export interface PersonalityStore extends PersonalityState {
  getState: () => PersonalityState
  setState: (partial: Partial<PersonalityState>) => void
  subscribe: (listener: (state: PersonalityState) => void) => () => void

  // Actions
  setActiveId: (id: string) => void
  addPersonality: (personality: Personality) => void
  updatePersonality: (id: string, updates: Partial<Personality>) => void
  deletePersonality: (id: string) => void
}

/**
 * Hub user object
 */
export interface HubUser {
  id: string
  email: string
  is_admin: boolean
}

/**
 * Extended SettingsState with Hub auth fields
 */
export interface SettingsStateWithAuth extends SettingsState {
  hubAccessToken?: string
  hubRefreshToken?: string
  hubUser?: HubUser
}

/**
 * Vision message content types
 * Can be simple string or multimodal array with text and images
 */
export type MessageContent = string | Array<{
  type: 'text' | 'image_url'
  text?: string
  image_url?: {
    url: string
    detail: string
  }
}>

/**
 * Page context for AI prompt injection
 */
export interface PageContext {
  url?: string
  title?: string
  domain?: string
  pageType?: string
  selectedText?: string
  [key: string]: unknown
}
