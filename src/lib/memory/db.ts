/**
 * IndexedDB Storage for Yumi Memory System
 *
 * Stores memories in IndexedDB with indexes for efficient querying.
 * Follows the same pattern as the chat db.ts for consistency.
 */

import type { Memory, MemoryType } from './types'
import { MEMORY_DB_CONFIG } from './types'
import { createLogger } from '../core/debug'

const log = createLogger('MemoryDB')
const { dbName, storeName, version } = MEMORY_DB_CONFIG

let dbInstance: IDBDatabase | null = null

/**
 * Open database connection (singleton pattern)
 */
async function getDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, version)

    request.onerror = () => {
      log.error(' Failed to open database:', request.error)
      reject(request.error)
    }

    request.onsuccess = () => {
      dbInstance = request.result
      log.log(' Database opened')
      resolve(dbInstance)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      if (!db.objectStoreNames.contains(storeName)) {
        const store = db.createObjectStore(storeName, { keyPath: 'id' })

        // Indexes for efficient querying
        store.createIndex('by-type', 'type', { unique: false })
        store.createIndex('by-importance', 'importance', { unique: false })
        store.createIndex('by-created', 'createdAt', { unique: false })
        store.createIndex('by-accessed', 'lastAccessed', { unique: false })

        log.log(' Memories store created')
      }
    }
  })
}

/**
 * Initialize the database (call on extension startup)
 */
export async function initMemoryDB(): Promise<IDBDatabase> {
  return getDB()
}

/**
 * Save a single memory
 */
export async function saveMemory(memory: Memory): Promise<void> {
  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite')
    const store = transaction.objectStore(storeName)
    const request = store.put(memory)

    request.onsuccess = () => resolve()
    request.onerror = () => {
      log.error(' Failed to save memory:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Save multiple memories in a single transaction
 */
export async function saveMemories(memories: Memory[]): Promise<void> {
  if (memories.length === 0) return

  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite')
    const store = transaction.objectStore(storeName)

    let completed = 0
    let hasError = false

    for (const memory of memories) {
      const request = store.put(memory)

      request.onsuccess = () => {
        completed++
        if (completed === memories.length && !hasError) {
          resolve()
        }
      }

      request.onerror = () => {
        if (!hasError) {
          hasError = true
          log.error(' Failed to save memory:', request.error)
          reject(request.error)
        }
      }
    }
  })
}

/**
 * Get a single memory by ID
 */
export async function getMemory(id: string): Promise<Memory | null> {
  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly')
    const store = transaction.objectStore(storeName)
    const request = store.get(id)

    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => {
      log.error(' Failed to get memory:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Get all memories
 */
export async function getAllMemories(): Promise<Memory[]> {
  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly')
    const store = transaction.objectStore(storeName)
    const request = store.getAll()

    request.onsuccess = () => {
      const memories = request.result as Memory[]
      // Sort by importance (highest first)
      memories.sort((a, b) => b.importance - a.importance)
      resolve(memories)
    }

    request.onerror = () => {
      log.error(' Failed to get all memories:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Get memories filtered by type
 */
export async function getMemoriesByType(type: MemoryType): Promise<Memory[]> {
  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly')
    const store = transaction.objectStore(storeName)
    const index = store.index('by-type')
    const request = index.getAll(type)

    request.onsuccess = () => {
      const memories = request.result as Memory[]
      // Sort by importance (highest first)
      memories.sort((a, b) => b.importance - a.importance)
      resolve(memories)
    }

    request.onerror = () => {
      log.error(' Failed to get memories by type:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Delete a single memory by ID
 */
export async function deleteMemory(id: string): Promise<void> {
  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite')
    const store = transaction.objectStore(storeName)
    const request = store.delete(id)

    request.onsuccess = () => resolve()
    request.onerror = () => {
      log.error(' Failed to delete memory:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Delete all memories of a specific type
 */
export async function deleteMemoriesByType(type: MemoryType): Promise<number> {
  const memories = await getMemoriesByType(type)
  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite')
    const store = transaction.objectStore(storeName)

    let deleted = 0
    let hasError = false

    if (memories.length === 0) {
      resolve(0)
      return
    }

    for (const memory of memories) {
      const request = store.delete(memory.id)

      request.onsuccess = () => {
        deleted++
        if (deleted === memories.length && !hasError) {
          log.log(` Deleted ${deleted} memories of type ${type}`)
          resolve(deleted)
        }
      }

      request.onerror = () => {
        if (!hasError) {
          hasError = true
          log.error(' Failed to delete memory:', request.error)
          reject(request.error)
        }
      }
    }
  })
}

/**
 * Clear all memories
 */
export async function clearAllMemories(): Promise<void> {
  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite')
    const store = transaction.objectStore(storeName)
    const request = store.clear()

    request.onsuccess = () => {
      log.log(' All memories cleared')
      resolve()
    }

    request.onerror = () => {
      log.error(' Failed to clear memories:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Update a memory (partial update)
 */
export async function updateMemory(
  id: string,
  updates: Partial<Omit<Memory, 'id'>>
): Promise<void> {
  const existing = await getMemory(id)

  if (!existing) {
    throw new Error(`Memory not found: ${id}`)
  }

  const updated: Memory = {
    ...existing,
    ...updates,
  }

  await saveMemory(updated)
}

/**
 * Mark a memory as accessed (updates lastAccessed and accessCount)
 */
export async function markMemoryAccessed(id: string): Promise<void> {
  const existing = await getMemory(id)

  if (!existing) {
    log.warn(` Cannot mark accessed - memory not found: ${id}`)
    return
  }

  await updateMemory(id, {
    lastAccessed: Date.now(),
    accessCount: existing.accessCount + 1,
  })
}

/**
 * Get memory count
 */
export async function getMemoryCount(): Promise<number> {
  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly')
    const store = transaction.objectStore(storeName)
    const request = store.count()

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      log.error(' Failed to count memories:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Get memories by IDs
 */
export async function getMemoriesByIds(ids: string[]): Promise<Memory[]> {
  if (ids.length === 0) return []

  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly')
    const store = transaction.objectStore(storeName)

    const memories: Memory[] = []
    let completed = 0
    let hasError = false

    for (const id of ids) {
      const request = store.get(id)

      request.onsuccess = () => {
        if (request.result) {
          memories.push(request.result)
        }
        completed++
        if (completed === ids.length && !hasError) {
          resolve(memories)
        }
      }

      request.onerror = () => {
        if (!hasError) {
          hasError = true
          log.error(' Failed to get memory:', request.error)
          reject(request.error)
        }
      }
    }
  })
}

/**
 * Get recent memories (sorted by lastAccessed)
 */
export async function getRecentMemories(limit: number = 20): Promise<Memory[]> {
  const all = await getAllMemories()

  // Sort by lastAccessed (most recent first)
  all.sort((a, b) => b.lastAccessed - a.lastAccessed)

  return all.slice(0, limit)
}

/**
 * Tokenize text into normalized words for similarity comparison
 */
function tokenize(text: string): Set<string> {
  const stopWords = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
    'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that',
    'the', 'to', 'was', 'were', 'will', 'with', 'this', 'they', 'their',
    'them', 'user', 'person', 'i', 'me', 'my', 'we', 'our', 'you', 'your',
  ])

  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))

  return new Set(words)
}

/**
 * Calculate Jaccard similarity between two texts
 */
function calculateSimilarity(text1: string, text2: string): number {
  const tokens1 = tokenize(text1)
  const tokens2 = tokenize(text2)

  if (tokens1.size === 0 && tokens2.size === 0) return 1
  if (tokens1.size === 0 || tokens2.size === 0) return 0

  let intersection = 0
  for (const token of tokens1) {
    if (tokens2.has(token)) intersection++
  }

  const union = tokens1.size + tokens2.size - intersection
  return intersection / union
}

/**
 * Check if a similar memory already exists (for deduplication)
 * Uses Jaccard similarity for better fuzzy matching
 */
export async function findSimilarMemory(
  content: string,
  type: MemoryType,
  similarityThreshold: number = 0.6
): Promise<Memory | null> {
  const memories = await getMemoriesByType(type)

  const normalizedContent = content.toLowerCase().trim()

  let bestMatch: Memory | null = null
  let bestSimilarity = 0

  for (const memory of memories) {
    const normalizedMemory = memory.content.toLowerCase().trim()

    // Check for exact match
    if (normalizedMemory === normalizedContent) {
      return memory
    }

    // Check for substring containment (one contains the other)
    if (
      normalizedMemory.includes(normalizedContent) ||
      normalizedContent.includes(normalizedMemory)
    ) {
      return memory
    }

    // Calculate Jaccard similarity
    const similarity = calculateSimilarity(content, memory.content)

    if (similarity > bestSimilarity && similarity >= similarityThreshold) {
      bestSimilarity = similarity
      bestMatch = memory
    }
  }

  if (bestMatch) {
    log.log(` Found similar memory (${(bestSimilarity * 100).toFixed(0)}% match): "${bestMatch.content.slice(0, 40)}..."`)
  }

  return bestMatch
}
