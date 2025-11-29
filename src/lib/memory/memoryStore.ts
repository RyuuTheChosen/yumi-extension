/**
 * Zustand Store for Yumi Memory System
 *
 * Manages memory state in-memory with IndexedDB persistence.
 * Unlike settings store which uses chrome.storage, this uses IndexedDB
 * for larger storage capacity and better query performance.
 */

import { create } from 'zustand'
import type { Memory, MemoryType, MemoryState, RetrievalOptions } from './types'
import { MEMORY_LIMITS, MEMORY_HALF_LIFE } from './types'
import {
  initMemoryDB,
  getAllMemories,
  saveMemory,
  saveMemories,
  deleteMemory,
  deleteMemoriesByType,
  clearAllMemories,
  markMemoryAccessed,
  findSimilarMemory,
  getMemoryCount,
} from './db'

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

  // Load memories from IndexedDB
  loadMemories: async () => {
    try {
      await initMemoryDB()
      const memories = await getAllMemories()
      set({ memories, isLoaded: true, lastError: null })
      console.log(`[MemoryStore] Loaded ${memories.length} memories`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load memories'
      set({ lastError: message, isLoaded: true })
      console.error('[MemoryStore] Failed to load memories:', error)
    }
  },

  // Add a single memory
  addMemory: async (memoryData) => {
    const now = Date.now()

    // Check for duplicates
    const existing = await findSimilarMemory(memoryData.content, memoryData.type)
    if (existing) {
      console.log('[MemoryStore] Similar memory exists, updating instead:', existing.id)
      // Update existing memory with potentially higher importance/confidence
      const updated: Memory = {
        ...existing,
        importance: Math.max(existing.importance, memoryData.importance),
        confidence: Math.max(existing.confidence, memoryData.confidence),
        lastAccessed: now,
        accessCount: existing.accessCount + 1,
      }
      await saveMemory(updated)
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

    await saveMemory(memory)
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
    const newMemories: Memory[] = []
    const updatedMemories: Memory[] = []

    for (const memoryData of memoriesData) {
      // Check for duplicates
      const existing = await findSimilarMemory(memoryData.content, memoryData.type)

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

    // Save all to IndexedDB
    if (newMemories.length > 0) {
      await saveMemories(newMemories)
    }
    for (const updated of updatedMemories) {
      await saveMemory(updated)
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
    await deleteMemory(id)
    set((state) => ({
      memories: state.memories.filter((m) => m.id !== id),
    }))
    console.log(`[MemoryStore] Removed memory: ${id}`)
  },

  // Remove all memories of a type
  removeMemoriesByType: async (type) => {
    await deleteMemoriesByType(type)
    set((state) => ({
      memories: state.memories.filter((m) => m.type !== type),
    }))
    console.log(`[MemoryStore] Removed all memories of type: ${type}`)
  },

  // Clear all memories
  clearAll: async () => {
    await clearAllMemories()
    set({ memories: [], lastExtractionAt: null })
    console.log('[MemoryStore] Cleared all memories')
  },

  // Mark memory as accessed
  markAccessed: async (id) => {
    await markMemoryAccessed(id)
    set((state) => ({
      memories: state.memories.map((m) =>
        m.id === id
          ? { ...m, lastAccessed: Date.now(), accessCount: m.accessCount + 1 }
          : m
      ),
    }))
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

    // Remove lowest importance memories
    const idsToRemove = withImportance.slice(0, toRemove).map(({ memory }) => memory.id)

    for (const id of idsToRemove) {
      await deleteMemory(id)
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
