/**
 * Scoped Chat Store for Overlay
 * 
 * Manages conversation threads with scope isolation:
 * - Per-origin threads (gmail.com vs github.com)
 * - Global cross-site thread
 * - In-memory streaming state
 * - IndexedDB persistence
 */

import { create } from 'zustand'
import type { Scope } from '../utils/scopes'
import {
  getCurrentScope,
  setCurrentScope,
  createOriginScope,
  createGlobalScope,
  formatScopeName
} from '../utils/scopes'
import type { Message, Thread } from '../utils/db'
import {
  getThreadMessages,
  addMessage,
  updateMessage,
  clearThread,
  pruneOldMessages,
  saveThread
} from '../utils/db'

export type ChatStatus = 'idle' | 'sending' | 'streaming' | 'error' | 'canceled'

interface ScopedChatState {
  // Current scope and threads
  currentScope: Scope
  threads: Map<string, Message[]>
  
  // Streaming state (in-memory only)
  streamingMessage: Message | null
  status: ChatStatus
  error: string | null
  
  // Private mode (no persistence)
  privateMode: boolean
  
  // UI state tracking
  isCleared: boolean
  
  // Actions
  switchScope: (scope: Scope) => Promise<void>
  sendMessage: (content: string, context?: Record<string, any>) => Promise<Array<{ role: string; content: string }> | undefined>
  updateStreamingMessage: (delta: string) => void
  finalizeStreamingMessage: () => Promise<void>
  hydrateThread: (scopeId: string) => Promise<void>
  clearCurrentThread: () => Promise<void>
  reloadThread: () => Promise<void>
  setError: (error: string | null) => void
  setStatus: (status: ChatStatus) => void
  togglePrivateMode: () => void
  addProactiveMessage: (content: string) => Promise<void>

  // Getters
  getCurrentMessages: () => Message[]
  getDisplayMessages: () => Message[]
}

export const useScopedChatStore = create<ScopedChatState>((set, get) => ({
  // Initial state
  currentScope: getCurrentScope(),
  threads: new Map(),
  streamingMessage: null,
  status: 'idle',
  error: null,
  privateMode: false,
  isCleared: false,
  
  /**
   * Switch to a different scope
   */
  switchScope: async (scope: Scope) => {
    console.log('[ScopedChat] Switching to scope:', scope.id)
    
    // Save current scope to session storage
    setCurrentScope(scope)
    
    // Check if this scope was cleared
    const wasCleared = sessionStorage.getItem(`yumi-cleared-${scope.id}`) === 'true'
    
    // Load messages for new scope (unless it was cleared)
    set({ currentScope: scope, streamingMessage: null, error: null, isCleared: wasCleared })
    
    if (!wasCleared) {
      await get().hydrateThread(scope.id)
    }
  },
  
  /**
   * Send a user message (creates placeholder for assistant response)
   * Returns conversation history for background context
   */
  sendMessage: async (content: string, context?: Record<string, any>) => {
    const { currentScope, privateMode, status } = get()
    
    if (!content.trim() || status === 'sending' || status === 'streaming') {
      console.warn('[ScopedChat] Cannot send: invalid state')
      return
    }
    
    const now = Date.now()

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: content.trim(),
      ts: now,
      scopeId: currentScope.id,
      meta: context,
      status: 'final'
    }

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      ts: now + 1, // Ensure assistant message always comes after user message
      scopeId: currentScope.id,
      status: 'streaming'
    }
    
    // Get current conversation history (before adding new messages)
    const currentMessages = get().threads.get(currentScope.id) || []
    
    // Add to in-memory thread
    const updatedMessages = [...currentMessages, userMessage, assistantMessage]
    
    const newThreads = new Map(get().threads)
    newThreads.set(currentScope.id, updatedMessages)
    
    set({
      threads: newThreads,
      streamingMessage: assistantMessage,
      status: 'sending',
      error: null
    })
    
    // Persist user message immediately (unless private mode)
    if (!privateMode) {
      try {
        await addMessage(userMessage)
      } catch (err) {
        console.error('[ScopedChat] Failed to persist user message:', err)
      }
    }
    
    // Return history for background context (last 10 messages)
    return currentMessages.slice(-10).map(msg => ({
      role: msg.role,
      content: msg.content
    }))
  },
  
  /**
   * Update streaming message with delta
   */
  updateStreamingMessage: (delta: string) => {
    const { streamingMessage, currentScope } = get()
    
    if (!streamingMessage) {
      console.warn('[ScopedChat] No streaming message to update')
      return
    }
    
    // Update in-memory message
    const updatedMessage: Message = {
      ...streamingMessage,
      content: streamingMessage.content + delta
    }
    
    // Update in threads map
    const currentMessages = get().threads.get(currentScope.id) || []
    const messageIndex = currentMessages.findIndex(m => m.id === streamingMessage.id)
    
    if (messageIndex !== -1) {
      const updatedMessages = [...currentMessages]
      updatedMessages[messageIndex] = updatedMessage
      
      const newThreads = new Map(get().threads)
      newThreads.set(currentScope.id, updatedMessages)
      
      set({ threads: newThreads, streamingMessage: updatedMessage, status: 'streaming' })
    }
  },
  
  /**
   * Finalize streaming message (write to DB)
   */
  finalizeStreamingMessage: async () => {
    const { streamingMessage, currentScope, privateMode } = get()
    
    if (!streamingMessage) {
      console.warn('[ScopedChat] No streaming message to finalize')
      set({ status: 'idle' })
      return
    }
    
    const finalMessage: Message = {
      ...streamingMessage,
      status: 'final'
    }
    
    // Update in threads map
    const currentMessages = get().threads.get(currentScope.id) || []
    const messageIndex = currentMessages.findIndex(m => m.id === streamingMessage.id)
    
    if (messageIndex !== -1) {
      const updatedMessages = [...currentMessages]
      updatedMessages[messageIndex] = finalMessage
      
      const newThreads = new Map(get().threads)
      newThreads.set(currentScope.id, updatedMessages)
      
      set({ threads: newThreads, streamingMessage: null, status: 'idle' })
    }
    
    // Persist to IndexedDB (unless private mode)
    if (!privateMode) {
      try {
        await addMessage(finalMessage)
        
        // Prune if needed (keep under 16k chars)
        const charCount = currentMessages.reduce((sum, m) => sum + m.content.length, 0)
        if (charCount > 16000) {
          await pruneOldMessages(currentScope.id, 16000)
          // Reload after pruning
          await get().hydrateThread(currentScope.id)
        }
      } catch (err) {
        console.error('[ScopedChat] Failed to persist assistant message:', err)
      }
    }
  },
  
  /**
   * Load messages from IndexedDB for a scope
   */
  hydrateThread: async (scopeId: string) => {
    try {
      const messages = await getThreadMessages(scopeId)
      
      const newThreads = new Map(get().threads)
      newThreads.set(scopeId, messages)
      
      set({ threads: newThreads })
      
      console.log(`[ScopedChat] Loaded ${messages.length} messages for scope ${scopeId}`)
    } catch (err) {
      console.error('[ScopedChat] Failed to hydrate thread:', err)
      set({ error: 'Failed to load messages' })
    }
  },
  
  /**
   * Clear all messages in current thread (UI only, keeps IndexedDB data)
   */
  clearCurrentThread: async () => {
    const { currentScope } = get()
    
    // Clear from in-memory state only (UI clears but messages persist in IndexedDB)
    const newThreads = new Map(get().threads)
    newThreads.set(currentScope.id, [])
    
    // Mark as cleared and persist state
    sessionStorage.setItem(`yumi-cleared-${currentScope.id}`, 'true')
    
    set({ threads: newThreads, streamingMessage: null, error: null, status: 'idle', isCleared: true })
    
    console.log(`[ScopedChat] Cleared UI for thread ${currentScope.id} (messages still in IndexedDB)`)
  },
  
  /**
   * Reload messages from IndexedDB (restore cleared conversation)
   */
  reloadThread: async () => {
    const { currentScope } = get()
    
    // Remove cleared flag
    sessionStorage.removeItem(`yumi-cleared-${currentScope.id}`)
    
    await get().hydrateThread(currentScope.id)
    set({ isCleared: false })
    
    console.log(`[ScopedChat] Reloaded thread ${currentScope.id} from IndexedDB`)
  },
  
  /**
   * Set error state
   */
  setError: (error: string | null) => {
    set({ error, status: error ? 'error' : get().status })
  },
  
  /**
   * Set status
   */
  setStatus: (status: ChatStatus) => {
    set({ status })
  },
  
  /**
   * Toggle private mode
   */
  togglePrivateMode: () => {
    set({ privateMode: !get().privateMode })
  },

  /**
   * Add a proactive message from Yumi (no user message, just assistant)
   */
  addProactiveMessage: async (content: string) => {
    const { currentScope, privateMode } = get()

    if (!content.trim()) {
      console.warn('[ScopedChat] Cannot add empty proactive message')
      return
    }

    const now = Date.now()

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: content.trim(),
      ts: now,
      scopeId: currentScope.id,
      status: 'final',
      meta: { proactive: true }
    }

    // Get current messages and add proactive message
    const currentMessages = get().threads.get(currentScope.id) || []
    const updatedMessages = [...currentMessages, assistantMessage]

    const newThreads = new Map(get().threads)
    newThreads.set(currentScope.id, updatedMessages)

    set({ threads: newThreads })

    // Persist to IndexedDB (unless private mode)
    if (!privateMode) {
      try {
        await addMessage(assistantMessage)
      } catch (err) {
        console.error('[ScopedChat] Failed to persist proactive message:', err)
      }
    }

    console.log('[ScopedChat] Added proactive message')
  },

  /**
   * Get current thread messages
   */
  getCurrentMessages: () => {
    const { currentScope, threads } = get()
    return threads.get(currentScope.id) || []
  },
  
  /**
   * Get display messages (filter out system messages)
   */
  getDisplayMessages: () => {
    return get().getCurrentMessages().filter(m => m.role !== 'system')
  }
}))

// Initialize on module load
;(async () => {
  const store = useScopedChatStore.getState()
  const currentScope = getCurrentScope()
  
  console.log('[ScopedChat] Initializing with scope:', currentScope.id)
  
  // Check if this scope was previously cleared
  const wasCleared = sessionStorage.getItem(`yumi-cleared-${currentScope.id}`) === 'true'
  
  if (wasCleared) {
    console.log('[ScopedChat] Scope was cleared, not loading messages')
    store.setStatus('idle')
    useScopedChatStore.setState({ isCleared: true })
  } else {
    // Load messages for current scope
    await store.hydrateThread(currentScope.id)
  }
})()
