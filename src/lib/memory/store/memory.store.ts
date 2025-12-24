/**
 * Zustand Store for Yumi Memory System
 *
 * Manages memory state in-memory with background script persistence.
 * All IndexedDB operations route through the background script to ensure
 * memories are shared across popup and content script contexts.
 */

import { create } from 'zustand'
import type { Memory, MemoryType, MemoryState, RetrievalOptions } from '../types'
import { MEMORY_LIMITS, MEMORY_HALF_LIFE } from '../types'
import { createLogger } from '../../core/debug'

const log = createLogger('MemoryStore')

/** Timeout for memory operations (10 seconds) */
const MEMORY_MESSAGE_TIMEOUT_MS = 10000

/**
 * Send message to background script for memory operations
 * Includes timeout to prevent indefinite hangs
 */
async function sendMemoryMessage<T>(type: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Memory operation '${type}' timed out after ${MEMORY_MESSAGE_TIMEOUT_MS}ms`))
    }, MEMORY_MESSAGE_TIMEOUT_MS)

    chrome.runtime.sendMessage({ type, payload }, (response) => {
      clearTimeout(timeoutId)

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

    log.log(` Found ${localMemories.length} local memories to migrate`)

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
    log.log(` Migrated ${localMemories.length} memories to extension storage`)
    return localMemories.length

  } catch (err) {
    // No local DB or migration failed - log the actual reason
    const message = err instanceof Error ? err.message : String(err)
    if (message === 'No local DB') {
      log.log(' No local DB found to migrate')
    } else {
      log.log(' Migration skipped:', message)
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

/**
 * Generate composite key for memory index (O(1) lookup)
 */
function getMemoryIndexKey(type: MemoryType, content: string): string {
  return `${type}:${content.toLowerCase()}`
}

/** Partial memory update fields */
export interface MemoryUpdate {
  content?: string
  context?: string
  type?: MemoryType
  importance?: number
  confidence?: number
  feedbackScore?: number
  userVerified?: boolean
}

/** Fields that are auto-generated when creating a memory */
type MemoryAutoFields = 'id' | 'createdAt' | 'lastAccessed' | 'accessCount' | 'usageCount' | 'feedbackScore' | 'userVerified'

interface MemoryStore extends MemoryState {
  /** Actions */
  loadMemories: () => Promise<void>
  addMemory: (
    memory: Omit<Memory, MemoryAutoFields>
  ) => Promise<Memory>
  addMemories: (
    memories: Omit<Memory, MemoryAutoFields>[]
  ) => Promise<Memory[]>
  updateMemory: (id: string, updates: MemoryUpdate) => Promise<void>
  removeMemory: (id: string) => Promise<void>
  removeMemories: (ids: string[]) => Promise<number>
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

  // Embedding
  generateEmbedding: (memoryId: string) => Promise<boolean>
  generateEmbeddingsForBatch: (memoryIds: string[]) => Promise<number>
}

// Memory index for O(1) duplicate detection (type:content -> Memory)
const memoryIndex = new Map<string, Memory>()

/**
 * Rebuild the memory index from current memories
 */
function rebuildIndex(memories: Memory[]): void {
  memoryIndex.clear()
  for (const memory of memories) {
    const key = getMemoryIndexKey(memory.type, memory.content)
    memoryIndex.set(key, memory)
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
      rebuildIndex(response.memories)
      set({ memories: response.memories, isLoaded: true, lastError: null })
      log.log(` Loaded ${response.memories.length} memories via background`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load memories'
      set({ lastError: message, isLoaded: true })
      log.error(' Failed to load memories:', error)
    }
  },

  /**
   * Add a single memory with atomic deduplication
   * Background script handles the similarity check to prevent race conditions
   */
  addMemory: async (memoryData) => {
    const now = Date.now()

    const memoryToAdd: Memory = {
      ...memoryData,
      id: generateId(),
      createdAt: now,
      lastAccessed: now,
      accessCount: 0,
      usageCount: 0,
      feedbackScore: 0,
      userVerified: false,
    }

    /** Delegate deduplication to background for atomicity */
    const response = await sendMemoryMessage<{ memory: Memory; isNew: boolean }>(
      'MEMORY_ADD_WITH_DEDUP',
      { memory: memoryToAdd }
    )

    const finalMemory = response.memory
    const indexKey = getMemoryIndexKey(finalMemory.type, finalMemory.content)
    memoryIndex.set(indexKey, finalMemory)

    if (response.isNew) {
      set((state) => ({ memories: [...state.memories, finalMemory] }))
      await get().pruneIfNeeded()
      log.log(` Added memory: ${finalMemory.type} - "${finalMemory.content.slice(0, 50)}..."`)
    } else {
      set((state) => ({
        memories: state.memories.map((m) => m.id === finalMemory.id ? finalMemory : m),
      }))
      log.log(` Updated existing memory: ${finalMemory.id}`)
    }

    return finalMemory
  },

  // Add multiple memories
  addMemories: async (memoriesData) => {
    if (memoriesData.length === 0) return []

    const now = Date.now()
    const newMemories: Memory[] = []
    const updatedMemories: Memory[] = []

    for (const memoryData of memoriesData) {
      // O(1) duplicate check using index
      const indexKey = getMemoryIndexKey(memoryData.type, memoryData.content)
      const existing = memoryIndex.get(indexKey)

      if (existing) {
        const updated: Memory = {
          ...existing,
          importance: Math.max(existing.importance, memoryData.importance),
          confidence: Math.max(existing.confidence, memoryData.confidence),
          lastAccessed: now,
          accessCount: existing.accessCount + 1,
        }
        updatedMemories.push(updated)
        memoryIndex.set(indexKey, updated)
      } else {
        const memory: Memory = {
          ...memoryData,
          id: generateId(),
          createdAt: now,
          lastAccessed: now,
          accessCount: 0,
          usageCount: 0,
          feedbackScore: 0,
          userVerified: false,
        }
        newMemories.push(memory)
        memoryIndex.set(indexKey, memory)
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

    log.log(
      `Added ${newMemories.length} new, updated ${updatedMemories.length} existing memories`
    )
    return [...newMemories, ...updatedMemories]
  },

  /** Update a memory by ID */
  updateMemory: async (id, updates) => {
    const { memories } = get()
    const memory = memories.find(m => m.id === id)
    if (!memory) {
      throw new Error(`Memory not found: ${id}`)
    }

    /** Remove old index key if content or type changed */
    const oldIndexKey = getMemoryIndexKey(memory.type, memory.content)

    /**
     * If user is editing content or type, mark as verified.
     * User verification indicates higher trust in this memory.
     */
    const isUserEdit = updates.content !== undefined || updates.type !== undefined
    const finalUpdates = isUserEdit && updates.userVerified === undefined
      ? { ...updates, userVerified: true }
      : updates

    await sendMemoryMessage('MEMORY_UPDATE', { id, updates: finalUpdates })

    const updated: Memory = {
      ...memory,
      ...finalUpdates,
    }

    /** Update index with new key */
    memoryIndex.delete(oldIndexKey)
    const newIndexKey = getMemoryIndexKey(updated.type, updated.content)
    memoryIndex.set(newIndexKey, updated)

    set((state) => ({
      memories: state.memories.map((m) => m.id === id ? updated : m),
    }))
    log.log(` Updated memory: ${id}`)
  },

  /** Remove a memory */
  removeMemory: async (id) => {
    const { memories } = get()
    const memory = memories.find(m => m.id === id)
    if (memory) {
      const indexKey = getMemoryIndexKey(memory.type, memory.content)
      memoryIndex.delete(indexKey)
    }
    await sendMemoryMessage('MEMORY_DELETE', { id })
    set((state) => ({
      memories: state.memories.filter((m) => m.id !== id),
    }))
    log.log(` Removed memory: ${id}`)
  },

  /** Remove multiple memories by IDs */
  removeMemories: async (ids) => {
    if (ids.length === 0) return 0

    const { memories } = get()
    const toDelete = memories.filter(m => ids.includes(m.id))

    /** Remove from index */
    for (const memory of toDelete) {
      const indexKey = getMemoryIndexKey(memory.type, memory.content)
      memoryIndex.delete(indexKey)
    }

    const response = await sendMemoryMessage<{ deleted: number }>(
      'MEMORY_DELETE_BATCH',
      { ids }
    )

    set((state) => ({
      memories: state.memories.filter((m) => !ids.includes(m.id)),
    }))
    log.log(` Removed ${response.deleted} memories`)
    return response.deleted
  },

  /** Remove all memories of a type (delete one by one via background) */
  removeMemoriesByType: async (type) => {
    const { memories } = get()
    const toDelete = memories.filter(m => m.type === type)

    // Remove from index
    for (const memory of toDelete) {
      const indexKey = getMemoryIndexKey(memory.type, memory.content)
      memoryIndex.delete(indexKey)
    }

    // Delete from storage
    for (const memory of toDelete) {
      await sendMemoryMessage('MEMORY_DELETE', { id: memory.id })
    }

    set((state) => ({
      memories: state.memories.filter((m) => m.type !== type),
    }))
    log.log(` Removed all memories of type: ${type}`)
  },

  // Clear all memories
  clearAll: async () => {
    await sendMemoryMessage('MEMORY_CLEAR_ALL')
    memoryIndex.clear()
    set({ memories: [], lastExtractionAt: null })
    log.log(' Cleared all memories')
  },

  // Mark memory as accessed
  markAccessed: async (id) => {
    const { memories } = get()
    const memory = memories.find(m => m.id === id)
    if (memory) {
      const updated = { ...memory, lastAccessed: Date.now(), accessCount: memory.accessCount + 1 }
      await sendMemoryMessage('MEMORY_ADD', { memory: updated })
      const indexKey = getMemoryIndexKey(memory.type, memory.content)
      memoryIndex.set(indexKey, updated)
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
      const indexKey = getMemoryIndexKey(memory.type, memory.content)
      memoryIndex.set(indexKey, updated)
      set((state) => ({
        memories: state.memories.map((m) => m.id === id ? updated : m),
      }))
      log.log(` Updated importance for ${id}: ${memory.importance.toFixed(2)} -> ${newImportance.toFixed(2)}`)
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

    log.log(` Pruning needed: ${count} memories`)

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

    log.log(` Pruned ${idsToRemove.length} memories`)
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

  /**
   * Generate embedding for a single memory
   */
  generateEmbedding: async (memoryId: string) => {
    const { memories, updateMemory } = get()
    const memory = memories.find(m => m.id === memoryId)

    if (!memory) {
      log.warn(`[MemoryStore] Memory ${memoryId} not found for embedding`)
      return false
    }

    const text = memory.content + (memory.context ? ' | ' + memory.context : '')

    try {
      const response = await sendMemoryMessage<{
        embeddings: number[][]
        model: string
      }>('MEMORY_EMBEDDING', { texts: [text], memoryIds: [memoryId] })

      if (response.embeddings && response.embeddings[0]) {
        await updateMemory(memoryId, {})

        /** Update memory with embedding via background */
        await sendMemoryMessage('MEMORY_UPDATE', {
          id: memoryId,
          updates: {}
        })

        /** Directly update in IndexedDB since embedding field not in MemoryUpdate */
        await sendMemoryMessage<{ success: boolean }>('MEMORY_ADD', {
          memory: {
            ...memory,
            embedding: response.embeddings[0],
            embeddingModel: response.model
          }
        })

        /** Update local state */
        set(state => ({
          memories: state.memories.map(m =>
            m.id === memoryId
              ? { ...m, embedding: response.embeddings[0], embeddingModel: response.model }
              : m
          )
        }))

        log.log(`[MemoryStore] Generated embedding for memory ${memoryId}`)
        return true
      }

      return false
    } catch (err) {
      log.error(`[MemoryStore] Failed to generate embedding for ${memoryId}:`, err)
      return false
    }
  },

  /**
   * Generate embeddings for a batch of memories
   */
  generateEmbeddingsForBatch: async (memoryIds: string[]) => {
    const { memories } = get()
    const targetMemories = memories.filter(m => memoryIds.includes(m.id))

    if (targetMemories.length === 0) return 0

    const texts = targetMemories.map(m =>
      m.content + (m.context ? ' | ' + m.context : '')
    )

    try {
      const response = await sendMemoryMessage<{
        embeddings: number[][]
        model: string
      }>('MEMORY_EMBEDDING', { texts, memoryIds })

      if (!response.embeddings || response.embeddings.length !== targetMemories.length) {
        log.warn('[MemoryStore] Embedding count mismatch')
        return 0
      }

      /** Update each memory with its embedding */
      let updated = 0
      for (let i = 0; i < targetMemories.length; i++) {
        const memory = targetMemories[i]
        const embedding = response.embeddings[i]

        if (embedding) {
          await sendMemoryMessage<{ success: boolean }>('MEMORY_ADD', {
            memory: {
              ...memory,
              embedding,
              embeddingModel: response.model
            }
          })
          updated++
        }
      }

      /** Update local state */
      set(state => ({
        memories: state.memories.map(m => {
          const idx = targetMemories.findIndex(tm => tm.id === m.id)
          if (idx !== -1 && response.embeddings[idx]) {
            return {
              ...m,
              embedding: response.embeddings[idx],
              embeddingModel: response.model
            }
          }
          return m
        })
      }))

      log.log(`[MemoryStore] Generated embeddings for ${updated} memories`)
      return updated
    } catch (err) {
      log.error('[MemoryStore] Failed to generate batch embeddings:', err)
      return 0
    }
  },
}))
