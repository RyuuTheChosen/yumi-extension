/**
 * Zustand Store for Yumi Memory System
 *
 * Manages memory state in-memory with background script persistence.
 * All IndexedDB operations route through the background script to ensure
 * memories are shared across popup and content script contexts.
 */

import { create } from 'zustand'
import type { Memory, MemoryType, MemoryState, RetrievalOptions } from './types'
import { MEMORY_LIMITS, MEMORY_HALF_LIFE } from './types'
import { findSimilarMemory } from './db'

/**
 * Send message to background script for memory operations
 */
async function sendMemoryMessage<T>(type: string, payload?: any): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      if (!response?.success) {
        reject(new Error(response?.error || 'Memory operation failed'))
        return
      }
      resolve(response as T)
    })
  })
}

/**
 * Migrate memories from local page IndexedDB to shared extension IndexedDB
 * This is needed because memories were previously stored per-page
 */
export async function migrateLocalMemories(): Promise<number> {
  try {
    // Try to open local page IndexedDB
    const localDB = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('yumi-memory', 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      request.onupgradeneeded = () => {
        // DB doesn't exist, nothing to migrate
        request.transaction?.abort()
        reject(new Error('No local DB'))
      }
    })

    // Read all memories from local DB
    const localMemories = await new Promise<Memory[]>((resolve, reject) => {
      const tx = localDB.transaction('memories', 'readonly')
      const store = tx.objectStore('memories')
      const request = store.getAll()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result || [])
    })

    if (localMemories.length === 0) {
      localDB.close()
      return 0
    }

    console.log(`[MemoryStore] Found ${localMemories.length} local memories to migrate`)

    // Send to background for storage in extension IndexedDB
    await sendMemoryMessage('MEMORY_ADD_BATCH', { memories: localMemories })

    // Clear local DB after successful migration
    await new Promise<void>((resolve, reject) => {
      const tx = localDB.transaction('memories', 'readwrite')
      const store = tx.objectStore('memories')
      const request = store.clear()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })

    localDB.close()
    console.log(`[MemoryStore] Migrated ${localMemories.length} memories to extension storage`)
    return localMemories.length

  } catch (err) {
    // No local DB or migration failed - log the actual reason
    const message = err instanceof Error ? err.message : String(err)
    if (message === 'No local DB') {
      console.log('[MemoryStore] No local DB found to migrate')
    } else {
      console.log('[MemoryStore] Migration skipped:', message)
    }
    return 0
  }
}

/**
 * Generate a UUID for memory IDs
 */
function generateId(): string {
  return crypto.randomUUID()
}

/**
 * Calculate decayed importance for a memory
 */
export function calculateDecayedImportance(memory: Memory): number {
  const halfLife = MEMORY_HALF_LIFE[memory.type]

  // Identity memories never decay
  if (halfLife === Infinity) {
    return memory.importance
  }

  const daysSinceAccess =
    (Date.now() - memory.lastAccessed) / (1000 * 60 * 60 * 24)
  const decayFactor = Math.pow(0.5, daysSinceAccess / halfLife)

  // Boost for frequently accessed memories (max 0.3 boost)
  const accessBoost = Math.min(memory.accessCount * 0.05, 0.3)

  return Math.min(memory.importance * decayFactor + accessBoost, 1)
}

interface MemoryStore extends MemoryState {
  // Actions
  loadMemories: () => Promise<void>
  addMemory: (
    memory: Omit<Memory, 'id' | 'createdAt' | 'lastAccessed' | 'accessCount'>
  ) => Promise<Memory>
  addMemories: (
    memories: Omit<Memory, 'id' | 'createdAt' | 'lastAccessed' | 'accessCount'>[]
  ) => Promise<Memory[]>
  removeMemory: (id: string) => Promise<void>
  removeMemoriesByType: (type: MemoryType) => Promise<void>
  clearAll: () => Promise<void>
  markAccessed: (id: string) => Promise<void>
  updateImportance: (id: string, delta: number) => Promise<void>
  setExtracting: (isExtracting: boolean) => void
  setLastExtractionAt: (timestamp: number) => void
  setError: (error: string | null) => void

  // Queries (in-memory for speed)
  getByType: (type: MemoryType) => Memory[]
  getRecent: (limit?: number) => Memory[]
  search: (query: string) => Memory[]
  getRelevant: (options?: RetrievalOptions) => Memory[]
  getMemoryById: (id: string) => Memory | undefined

  // Utilities
  pruneIfNeeded: () => Promise<void>
  getStats: () => {
    total: number
    byType: Record<MemoryType, number>
    oldestMemory: number | null
    newestMemory: number | null
  }
}

export const useMemoryStore = create<MemoryStore>()((set, get) => ({
  // Initial state
  memories: [],
  isLoaded: false,
  isExtracting: false,
  lastExtractionAt: null,
  lastError: null,

  // Load memories from background script (shared IndexedDB)
  loadMemories: async () => {
    try {
      const response = await sendMemoryMessage<{ memories: Memory[] }>('MEMORY_GET_ALL')
      set({ memories: response.memories, isLoaded: true, lastError: null })
      console.log(`[MemoryStore] Loaded ${response.memories.length} memories via background`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load memories'
      set({ lastError: message, isLoaded: true })
      console.error('[MemoryStore] Failed to load memories:', error)
    }
  },

  // Add a single memory
  addMemory: async (memoryData) => {
    const now = Date.now()

    // Check for duplicates in local state
    const { memories } = get()
    const existing = memories.find(m =>
      m.type === memoryData.type &&
      m.content.toLowerCase() === memoryData.content.toLowerCase()
    )

    if (existing) {
      console.log('[MemoryStore] Similar memory exists, updating instead:', existing.id)
      const updated: Memory = {
        ...existing,
        importance: Math.max(existing.importance, memoryData.importance),
        confidence: Math.max(existing.confidence, memoryData.confidence),
        lastAccessed: now,
        accessCount: existing.accessCount + 1,
      }
      await sendMemoryMessage('MEMORY_ADD', { memory: updated })
      set((state) => ({
        memories: state.memories.map((m) => (m.id === existing.id ? updated : m)),
      }))
      return updated
    }

    const memory: Memory = {
      ...memoryData,
      id: generateId(),
      createdAt: now,
      lastAccessed: now,
      accessCount: 0,
    }

    await sendMemoryMessage('MEMORY_ADD', { memory })
    set((state) => ({ memories: [...state.memories, memory] }))

    // Check if pruning needed
    await get().pruneIfNeeded()

    console.log(`[MemoryStore] Added memory: ${memory.type} - "${memory.content.slice(0, 50)}..."`)
    return memory
  },

  // Add multiple memories
  addMemories: async (memoriesData) => {
    if (memoriesData.length === 0) return []

    const now = Date.now()
    const { memories: currentMemories } = get()
    const newMemories: Memory[] = []
    const updatedMemories: Memory[] = []

    for (const memoryData of memoriesData) {
      // Check for duplicates in local state
      const existing = currentMemories.find(m =>
        m.type === memoryData.type &&
        m.content.toLowerCase() === memoryData.content.toLowerCase()
      )

      if (existing) {
        const updated: Memory = {
          ...existing,
          importance: Math.max(existing.importance, memoryData.importance),
          confidence: Math.max(existing.confidence, memoryData.confidence),
          lastAccessed: now,
          accessCount: existing.accessCount + 1,
        }
        updatedMemories.push(updated)
      } else {
        const memory: Memory = {
          ...memoryData,
          id: generateId(),
          createdAt: now,
          lastAccessed: now,
          accessCount: 0,
        }
        newMemories.push(memory)
      }
    }

    // Save all via background script
    const allToSave = [...newMemories, ...updatedMemories]
    if (allToSave.length > 0) {
      await sendMemoryMessage('MEMORY_ADD_BATCH', { memories: allToSave })
    }

    // Update state
    set((state) => {
      let memories = [...state.memories]

      // Update existing
      for (const updated of updatedMemories) {
        memories = memories.map((m) => (m.id === updated.id ? updated : m))
      }

      // Add new
      memories = [...memories, ...newMemories]

      return { memories }
    })

    // Check if pruning needed
    await get().pruneIfNeeded()

    console.log(
      `[MemoryStore] Added ${newMemories.length} new, updated ${updatedMemories.length} existing memories`
    )
    return [...newMemories, ...updatedMemories]
  },

  // Remove a memory
  removeMemory: async (id) => {
    await sendMemoryMessage('MEMORY_DELETE', { id })
    set((state) => ({
      memories: state.memories.filter((m) => m.id !== id),
    }))
    console.log(`[MemoryStore] Removed memory: ${id}`)
  },

  // Remove all memories of a type (delete one by one via background)
  removeMemoriesByType: async (type) => {
    const { memories } = get()
    const idsToDelete = memories.filter(m => m.type === type).map(m => m.id)
    for (const id of idsToDelete) {
      await sendMemoryMessage('MEMORY_DELETE', { id })
    }
    set((state) => ({
      memories: state.memories.filter((m) => m.type !== type),
    }))
    console.log(`[MemoryStore] Removed all memories of type: ${type}`)
  },

  // Clear all memories
  clearAll: async () => {
    await sendMemoryMessage('MEMORY_CLEAR_ALL')
    set({ memories: [], lastExtractionAt: null })
    console.log('[MemoryStore] Cleared all memories')
  },

  // Mark memory as accessed
  markAccessed: async (id) => {
    const { memories } = get()
    const memory = memories.find(m => m.id === id)
    if (memory) {
      const updated = { ...memory, lastAccessed: Date.now(), accessCount: memory.accessCount + 1 }
      await sendMemoryMessage('MEMORY_ADD', { memory: updated })
      set((state) => ({
        memories: state.memories.map((m) => m.id === id ? updated : m),
      }))
    }
  },

  // Update memory importance by delta (for proactive feedback)
  updateImportance: async (id, delta) => {
    const { memories } = get()
    const memory = memories.find(m => m.id === id)
    if (memory) {
      // Clamp importance between 0 and 1
      const newImportance = Math.max(0, Math.min(1, memory.importance + delta))
      const updated = { ...memory, importance: newImportance }
      await sendMemoryMessage('MEMORY_ADD', { memory: updated })
      set((state) => ({
        memories: state.memories.map((m) => m.id === id ? updated : m),
      }))
      console.log(`[MemoryStore] Updated importance for ${id}: ${memory.importance.toFixed(2)} -> ${newImportance.toFixed(2)}`)
    }
  },

  // Set extraction state
  setExtracting: (isExtracting) => set({ isExtracting }),

  // Set last extraction timestamp
  setLastExtractionAt: (timestamp) => set({ lastExtractionAt: timestamp }),

  // Set error
  setError: (error) => set({ lastError: error }),

  // Get memories by type
  getByType: (type) => {
    return get().memories.filter((m) => m.type === type)
  },

  // Get recent memories
  getRecent: (limit = 20) => {
    const { memories } = get()
    return [...memories]
      .sort((a, b) => b.lastAccessed - a.lastAccessed)
      .slice(0, limit)
  },

  // Simple keyword search
  search: (query) => {
    const { memories } = get()
    const lowerQuery = query.toLowerCase()

    return memories.filter(
      (m) =>
        m.content.toLowerCase().includes(lowerQuery) ||
        m.context?.toLowerCase().includes(lowerQuery)
    )
  },

  // Get relevant memories with filtering
  getRelevant: (options = {}) => {
    const {
      limit = 20,
      types,
      minImportance = 0,
      minConfidence = 0,
      applyDecay = true,
    } = options

    let { memories } = get()

    // Filter by types
    if (types && types.length > 0) {
      memories = memories.filter((m) => types.includes(m.type))
    }

    // Filter by confidence
    memories = memories.filter((m) => m.confidence >= minConfidence)

    // Calculate effective importance (with optional decay)
    const withEffectiveImportance = memories.map((m) => ({
      memory: m,
      effectiveImportance: applyDecay
        ? calculateDecayedImportance(m)
        : m.importance,
    }))

    // Filter by minimum importance
    const filtered = withEffectiveImportance.filter(
      ({ effectiveImportance }) => effectiveImportance >= minImportance
    )

    // Sort by effective importance
    filtered.sort((a, b) => b.effectiveImportance - a.effectiveImportance)

    return filtered.slice(0, limit).map(({ memory }) => memory)
  },

  // Get memory by ID
  getMemoryById: (id) => {
    return get().memories.find((m) => m.id === id)
  },

  // Prune old/low-importance memories if limits exceeded
  pruneIfNeeded: async () => {
    const { memories } = get()
    const count = memories.length

    if (count < MEMORY_LIMITS.maxTotalMemories * MEMORY_LIMITS.pruneThreshold) {
      return // No pruning needed
    }

    console.log(`[MemoryStore] Pruning needed: ${count} memories`)

    // Calculate effective importance for all
    const withImportance = memories.map((m) => ({
      memory: m,
      effectiveImportance: calculateDecayedImportance(m),
    }))

    // Sort by effective importance (lowest first)
    withImportance.sort((a, b) => a.effectiveImportance - b.effectiveImportance)

    // Calculate how many to remove
    const targetCount = Math.floor(
      MEMORY_LIMITS.maxTotalMemories * MEMORY_LIMITS.pruneTarget
    )
    const toRemove = count - targetCount

    if (toRemove <= 0) return

    // Remove lowest importance memories via background
    const idsToRemove = withImportance.slice(0, toRemove).map(({ memory }) => memory.id)

    for (const id of idsToRemove) {
      await sendMemoryMessage('MEMORY_DELETE', { id })
    }

    set((state) => ({
      memories: state.memories.filter((m) => !idsToRemove.includes(m.id)),
    }))

    console.log(`[MemoryStore] Pruned ${idsToRemove.length} memories`)
  },

  // Get statistics
  getStats: () => {
    const { memories } = get()

    const byType: Record<MemoryType, number> = {
      identity: 0,
      preference: 0,
      skill: 0,
      project: 0,
      person: 0,
      event: 0,
      opinion: 0,
    }

    let oldest: number | null = null
    let newest: number | null = null

    for (const m of memories) {
      byType[m.type]++

      if (oldest === null || m.createdAt < oldest) {
        oldest = m.createdAt
      }
      if (newest === null || m.createdAt > newest) {
        newest = m.createdAt
      }
    }

    return {
      total: memories.length,
      byType,
      oldestMemory: oldest,
      newestMemory: newest,
    }
  },
}))
