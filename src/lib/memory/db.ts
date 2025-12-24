/**
 * IndexedDB Storage for Yumi Memory System
 *
 * Stores memories in IndexedDB with indexes for efficient querying.
 * Follows the same pattern as the chat db.ts for consistency.
 */

import type { Memory, MemoryType, EntityLink, ConversationSummary } from './types'
import { MEMORY_DB_CONFIG } from './types'
import { createLogger } from '../core/debug'

const log = createLogger('MemoryDB')
const { dbName, storeName, entitiesStoreName, summariesStoreName, version } = MEMORY_DB_CONFIG

let dbInstance: IDBDatabase | null = null

/**
 * Retry configuration for IndexedDB operations
 */
const DB_RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 1000,
}

/**
 * Execute an IndexedDB operation with exponential backoff retry
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= DB_RETRY_CONFIG.maxRetries; attempt++) {
    try {
      return await operation()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))

      if (attempt < DB_RETRY_CONFIG.maxRetries) {
        const delay = Math.min(
          DB_RETRY_CONFIG.initialDelayMs * Math.pow(2, attempt),
          DB_RETRY_CONFIG.maxDelayMs
        )
        log.warn(`[MemoryDB] ${operationName} failed (attempt ${attempt + 1}), retrying in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  log.error(`[MemoryDB] ${operationName} failed after ${DB_RETRY_CONFIG.maxRetries} retries:`, lastError)
  throw lastError
}

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
      const oldVersion = event.oldVersion

      if (!db.objectStoreNames.contains(storeName)) {
        const store = db.createObjectStore(storeName, { keyPath: 'id' })

        store.createIndex('by-type', 'type', { unique: false })
        store.createIndex('by-importance', 'importance', { unique: false })
        store.createIndex('by-created', 'createdAt', { unique: false })
        store.createIndex('by-accessed', 'lastAccessed', { unique: false })
        store.createIndex('by-type-importance', ['type', 'importance'], { unique: false })
        store.createIndex('by-accessed-confidence', ['lastAccessed', 'confidence'], { unique: false })
        store.createIndex('by-feedback', 'feedbackScore', { unique: false })
        store.createIndex('by-usage', 'usageCount', { unique: false })

        log.log('[MemoryDB] Memories store created with v4 schema')
      } else {
        const transaction = (event.target as IDBOpenDBRequest).transaction
        if (transaction) {
          const store = transaction.objectStore(storeName)

          /** v2 migration: compound indexes */
          if (oldVersion < 2) {
            if (!store.indexNames.contains('by-type-importance')) {
              store.createIndex('by-type-importance', ['type', 'importance'], { unique: false })
            }
            if (!store.indexNames.contains('by-accessed-confidence')) {
              store.createIndex('by-accessed-confidence', ['lastAccessed', 'confidence'], { unique: false })
            }
            log.log('[MemoryDB] Migrated to v2 with compound indexes')
          }

          /** v3 migration: feedback indexes */
          if (oldVersion < 3) {
            if (!store.indexNames.contains('by-feedback')) {
              store.createIndex('by-feedback', 'feedbackScore', { unique: false })
            }
            if (!store.indexNames.contains('by-usage')) {
              store.createIndex('by-usage', 'usageCount', { unique: false })
            }
            log.log('[MemoryDB] Migrated to v3 with feedback indexes')
          }

          /** v4 migration: embedding fields (no index needed, stored in document) */
          if (oldVersion < 4) {
            log.log('[MemoryDB] Migrated to v4 with embedding support')
          }

          /** v5 migration: entities store for clustering */
          if (oldVersion < 5) {
            if (!db.objectStoreNames.contains(entitiesStoreName)) {
              const entitiesStore = db.createObjectStore(entitiesStoreName, { keyPath: 'entityId' })

              entitiesStore.createIndex('by-type', 'entityType', { unique: false })
              entitiesStore.createIndex('by-name', 'entityName', { unique: false })
              entitiesStore.createIndex('by-updated', 'updatedAt', { unique: false })

              log.log('[MemoryDB] Migrated to v5 with entities store')
            }
          }

          /** v6 migration: conversation summaries store */
          if (oldVersion < 6) {
            if (!db.objectStoreNames.contains(summariesStoreName)) {
              const summariesStore = db.createObjectStore(summariesStoreName, { keyPath: 'id' })

              summariesStore.createIndex('by-conversation', 'conversationId', { unique: false })
              summariesStore.createIndex('by-created', 'createdAt', { unique: false })
              summariesStore.createIndex('by-url', 'url', { unique: false })

              log.log('[MemoryDB] Migrated to v6 with summaries store')
            }
          }
        }
      }

      /** Create entities store if it doesn't exist (fresh install at v5+) */
      if (!db.objectStoreNames.contains(entitiesStoreName)) {
        const entitiesStore = db.createObjectStore(entitiesStoreName, { keyPath: 'entityId' })

        entitiesStore.createIndex('by-type', 'entityType', { unique: false })
        entitiesStore.createIndex('by-name', 'entityName', { unique: false })
        entitiesStore.createIndex('by-updated', 'updatedAt', { unique: false })

        log.log('[MemoryDB] Entities store created')
      }

      /** Create summaries store if it doesn't exist (fresh install at v6+) */
      if (!db.objectStoreNames.contains(summariesStoreName)) {
        const summariesStore = db.createObjectStore(summariesStoreName, { keyPath: 'id' })

        summariesStore.createIndex('by-conversation', 'conversationId', { unique: false })
        summariesStore.createIndex('by-created', 'createdAt', { unique: false })
        summariesStore.createIndex('by-url', 'url', { unique: false })

        log.log('[MemoryDB] Summaries store created')
      }
    }
  })
}

/**
 * Migrate existing memories to v3 schema by adding default feedback fields.
 * Should be called after database is opened.
 */
export async function migrateToV3(): Promise<number> {
  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite')
    const store = transaction.objectStore(storeName)
    const request = store.getAll()

    request.onsuccess = () => {
      const memories = request.result as Memory[]
      let migrated = 0

      for (const memory of memories) {
        /** Check if memory needs migration (missing v3 fields) */
        if (
          memory.usageCount === undefined ||
          memory.feedbackScore === undefined ||
          memory.userVerified === undefined
        ) {
          const updated = {
            ...memory,
            usageCount: memory.usageCount ?? 0,
            feedbackScore: memory.feedbackScore ?? 0,
            userVerified: memory.userVerified ?? false,
          }
          store.put(updated)
          migrated++
        }
      }

      transaction.oncomplete = () => {
        if (migrated > 0) {
          log.log(`[MemoryDB] Migrated ${migrated} memories to v3 schema`)
        }
        resolve(migrated)
      }

      transaction.onerror = () => reject(transaction.error)
    }

    request.onerror = () => reject(request.error)
  })
}

/**
 * Initialize the database (call on extension startup)
 * Runs data migration for v3 fields after opening.
 */
export async function initMemoryDB(): Promise<IDBDatabase> {
  const db = await getDB()
  await migrateToV3()
  return db
}

/**
 * Save a single memory with retry logic
 */
export async function saveMemory(memory: Memory): Promise<void> {
  return withRetry(async () => {
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
  }, 'saveMemory')
}

/**
 * Save multiple memories in a single transaction with retry logic
 */
export async function saveMemories(memories: Memory[]): Promise<void> {
  if (memories.length === 0) return

  return withRetry(async () => {
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
  }, 'saveMemories')
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
 * Delete a single memory by ID with retry logic
 */
export async function deleteMemory(id: string): Promise<void> {
  return withRetry(async () => {
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
  }, 'deleteMemory')
}

/**
 * Delete multiple memories by IDs in a single transaction
 */
export async function deleteMemories(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0

  return withRetry(async () => {
    const db = await getDB()

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite')
      const store = transaction.objectStore(storeName)

      let deleted = 0
      let hasError = false

      for (const id of ids) {
        const request = store.delete(id)

        request.onsuccess = () => {
          deleted++
          if (deleted === ids.length && !hasError) {
            log.log(`[MemoryDB] Deleted ${deleted} memories`)
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
  }, 'deleteMemories')
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

/**
 * Pagination options for memory queries
 */
export interface PaginationOptions {
  limit?: number
  offset?: number
  sortBy?: 'importance' | 'createdAt' | 'lastAccessed'
  sortOrder?: 'asc' | 'desc'
}

/**
 * Get memories with pagination support
 */
export async function getMemoriesPaginated(
  options: PaginationOptions = {}
): Promise<{ memories: Memory[]; total: number; hasMore: boolean }> {
  const {
    limit = 50,
    offset = 0,
    sortBy = 'importance',
    sortOrder = 'desc'
  } = options

  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly')
    const store = transaction.objectStore(storeName)

    const countRequest = store.count()

    countRequest.onsuccess = () => {
      const total = countRequest.result

      const getAllRequest = store.getAll()

      getAllRequest.onsuccess = () => {
        let memories = getAllRequest.result as Memory[]

        memories.sort((a, b) => {
          const aVal = a[sortBy] as number
          const bVal = b[sortBy] as number
          return sortOrder === 'desc' ? bVal - aVal : aVal - bVal
        })

        const paginated = memories.slice(offset, offset + limit)

        resolve({
          memories: paginated,
          total,
          hasMore: offset + limit < total
        })
      }

      getAllRequest.onerror = () => reject(getAllRequest.error)
    }

    countRequest.onerror = () => reject(countRequest.error)
  })
}

/**
 * Delete expired memories based on expiresAt field
 * @returns Count of deleted memories
 */
export async function cleanupExpiredMemories(): Promise<number> {
  const now = Date.now()
  const allMemories = await getAllMemories()

  const expired = allMemories.filter(m => m.expiresAt && m.expiresAt < now)

  if (expired.length === 0) {
    return 0
  }

  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite')
    const store = transaction.objectStore(storeName)

    let deleted = 0
    let hasError = false

    for (const memory of expired) {
      const request = store.delete(memory.id)

      request.onsuccess = () => {
        deleted++
        if (deleted === expired.length && !hasError) {
          log.log(`[MemoryDB] Cleaned up ${deleted} expired memories`)
          resolve(deleted)
        }
      }

      request.onerror = () => {
        if (!hasError) {
          hasError = true
          reject(request.error)
        }
      }
    }
  })
}

/**
 * Memory export format
 */
export interface MemoryExport {
  version: number
  exportedAt: number
  memories: Memory[]
}

/**
 * Export all memories to JSON format
 */
export async function exportMemories(): Promise<MemoryExport> {
  const memories = await getAllMemories()

  return {
    version: MEMORY_DB_CONFIG.version,
    exportedAt: Date.now(),
    memories,
  }
}

/**
 * Import memories from JSON export
 * @param exportData - The exported data to import
 * @param mode - 'merge' keeps existing, 'replace' clears first
 */
export async function importMemories(
  exportData: MemoryExport,
  mode: 'merge' | 'replace' = 'merge'
): Promise<{ imported: number; skipped: number; errors: number }> {
  const { memories } = exportData

  if (mode === 'replace') {
    await clearAllMemories()
  }

  let imported = 0
  let skipped = 0
  let errors = 0

  for (const memory of memories) {
    try {
      if (mode === 'merge') {
        const existing = await findSimilarMemory(memory.content, memory.type)
        if (existing) {
          skipped++
          continue
        }
      }

      await saveMemory(memory)
      imported++
    } catch (err) {
      log.error(' Failed to import memory:', err)
      errors++
    }
  }

  log.log(`[MemoryDB] Import complete: ${imported} imported, ${skipped} skipped, ${errors} errors`)

  return { imported, skipped, errors }
}

/**
 * Save an entity link with retry logic
 */
export async function saveEntityLink(entity: EntityLink): Promise<void> {
  return withRetry(async () => {
    const db = await getDB()

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([entitiesStoreName], 'readwrite')
      const store = transaction.objectStore(entitiesStoreName)
      const request = store.put(entity)

      request.onsuccess = () => resolve()
      request.onerror = () => {
        log.error(' Failed to save entity:', request.error)
        reject(request.error)
      }
    })
  }, 'saveEntityLink')
}

/**
 * Get an entity link by ID
 */
export async function getEntityLink(entityId: string): Promise<EntityLink | null> {
  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([entitiesStoreName], 'readonly')
    const store = transaction.objectStore(entitiesStoreName)
    const request = store.get(entityId)

    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => {
      log.error(' Failed to get entity:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Get all entity links
 */
export async function getAllEntityLinks(): Promise<EntityLink[]> {
  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([entitiesStoreName], 'readonly')
    const store = transaction.objectStore(entitiesStoreName)
    const request = store.getAll()

    request.onsuccess = () => {
      const entities = request.result as EntityLink[]
      entities.sort((a, b) => b.updatedAt - a.updatedAt)
      resolve(entities)
    }

    request.onerror = () => {
      log.error(' Failed to get all entities:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Get entities by type
 */
export async function getEntitiesByType(entityType: EntityLink['entityType']): Promise<EntityLink[]> {
  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([entitiesStoreName], 'readonly')
    const store = transaction.objectStore(entitiesStoreName)
    const index = store.index('by-type')
    const request = index.getAll(entityType)

    request.onsuccess = () => {
      const entities = request.result as EntityLink[]
      entities.sort((a, b) => b.updatedAt - a.updatedAt)
      resolve(entities)
    }

    request.onerror = () => {
      log.error(' Failed to get entities by type:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Find entities that contain a memory ID
 */
export async function getEntitiesForMemory(memoryId: string): Promise<EntityLink[]> {
  const allEntities = await getAllEntityLinks()
  return allEntities.filter(entity => entity.memoryIds.includes(memoryId))
}

/**
 * Delete an entity link by ID
 */
export async function deleteEntityLink(entityId: string): Promise<void> {
  return withRetry(async () => {
    const db = await getDB()

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([entitiesStoreName], 'readwrite')
      const store = transaction.objectStore(entitiesStoreName)
      const request = store.delete(entityId)

      request.onsuccess = () => resolve()
      request.onerror = () => {
        log.error(' Failed to delete entity:', request.error)
        reject(request.error)
      }
    })
  }, 'deleteEntityLink')
}

/**
 * Remove a memory ID from all entity links.
 * Called when a memory is deleted to keep entity links in sync.
 */
export async function removeMemoryFromEntities(memoryId: string): Promise<number> {
  const entities = await getEntitiesForMemory(memoryId)
  let updated = 0

  for (const entity of entities) {
    const newMemoryIds = entity.memoryIds.filter(id => id !== memoryId)

    if (newMemoryIds.length === 0) {
      await deleteEntityLink(entity.entityId)
      log.log(`[MemoryDB] Deleted orphaned entity: ${entity.entityName}`)
    } else if (newMemoryIds.length !== entity.memoryIds.length) {
      await saveEntityLink({
        ...entity,
        memoryIds: newMemoryIds,
        updatedAt: Date.now()
      })
      updated++
    }
  }

  return updated
}

/**
 * Clear all entity links
 */
export async function clearAllEntityLinks(): Promise<void> {
  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([entitiesStoreName], 'readwrite')
    const store = transaction.objectStore(entitiesStoreName)
    const request = store.clear()

    request.onsuccess = () => {
      log.log(' All entity links cleared')
      resolve()
    }

    request.onerror = () => {
      log.error(' Failed to clear entity links:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Save a conversation summary with retry logic
 */
export async function saveSummary(summary: ConversationSummary): Promise<void> {
  return withRetry(async () => {
    const db = await getDB()

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([summariesStoreName], 'readwrite')
      const store = transaction.objectStore(summariesStoreName)
      const request = store.put(summary)

      request.onsuccess = () => resolve()
      request.onerror = () => {
        log.error(' Failed to save summary:', request.error)
        reject(request.error)
      }
    })
  }, 'saveSummary')
}

/**
 * Get a conversation summary by ID
 */
export async function getSummary(id: string): Promise<ConversationSummary | null> {
  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([summariesStoreName], 'readonly')
    const store = transaction.objectStore(summariesStoreName)
    const request = store.get(id)

    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => {
      log.error(' Failed to get summary:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Get summary by conversation ID
 */
export async function getSummaryByConversationId(conversationId: string): Promise<ConversationSummary | null> {
  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([summariesStoreName], 'readonly')
    const store = transaction.objectStore(summariesStoreName)
    const index = store.index('by-conversation')
    const request = index.get(conversationId)

    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => {
      log.error(' Failed to get summary by conversation:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Get all conversation summaries
 */
export async function getAllSummaries(): Promise<ConversationSummary[]> {
  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([summariesStoreName], 'readonly')
    const store = transaction.objectStore(summariesStoreName)
    const request = store.getAll()

    request.onsuccess = () => {
      const summaries = request.result as ConversationSummary[]
      summaries.sort((a, b) => b.createdAt - a.createdAt)
      resolve(summaries)
    }

    request.onerror = () => {
      log.error(' Failed to get all summaries:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Get recent conversation summaries
 */
export async function getRecentSummaries(limit: number = 10): Promise<ConversationSummary[]> {
  const summaries = await getAllSummaries()
  return summaries.slice(0, limit)
}

/**
 * Get summaries by URL (for finding related conversations on same site)
 */
export async function getSummariesByUrl(url: string): Promise<ConversationSummary[]> {
  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([summariesStoreName], 'readonly')
    const store = transaction.objectStore(summariesStoreName)
    const index = store.index('by-url')
    const request = index.getAll(url)

    request.onsuccess = () => {
      const summaries = request.result as ConversationSummary[]
      summaries.sort((a, b) => b.createdAt - a.createdAt)
      resolve(summaries)
    }

    request.onerror = () => {
      log.error(' Failed to get summaries by URL:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Delete a conversation summary
 */
export async function deleteSummary(id: string): Promise<void> {
  return withRetry(async () => {
    const db = await getDB()

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([summariesStoreName], 'readwrite')
      const store = transaction.objectStore(summariesStoreName)
      const request = store.delete(id)

      request.onsuccess = () => resolve()
      request.onerror = () => {
        log.error(' Failed to delete summary:', request.error)
        reject(request.error)
      }
    })
  }, 'deleteSummary')
}

/**
 * Clear all conversation summaries
 */
export async function clearAllSummaries(): Promise<void> {
  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([summariesStoreName], 'readwrite')
    const store = transaction.objectStore(summariesStoreName)
    const request = store.clear()

    request.onsuccess = () => {
      log.log(' All summaries cleared')
      resolve()
    }

    request.onerror = () => {
      log.error(' Failed to clear summaries:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Get summaries that link to specific memory IDs
 */
export async function getSummariesForMemories(memoryIds: string[]): Promise<ConversationSummary[]> {
  const allSummaries = await getAllSummaries()

  return allSummaries.filter(summary =>
    summary.memoryIds.some(id => memoryIds.includes(id))
  )
}
