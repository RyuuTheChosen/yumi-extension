/**
 * IndexedDB Storage for Downloaded Companions
 *
 * Stores companion metadata and binary files (Live2D models, textures, etc.)
 * in IndexedDB for offline use after download.
 */

import type { CompanionManifest, CompanionPersonality } from './types'
import { createLogger } from '../debug'

const log = createLogger('CompanionDB')

// Database configuration
const DB_NAME = 'yumi-companions'
const DB_VERSION = 1
const COMPANIONS_STORE = 'companions'
const FILES_STORE = 'files'

// Stored companion metadata
export interface StoredCompanion {
  slug: string
  manifest: CompanionManifest
  personality: CompanionPersonality
  version: string
  checksumSha256: string
  downloadedAt: number
  lastUsedAt: number
  packageSizeBytes: number
}

// Stored file (binary blob)
export interface StoredFile {
  id: string  // Composite key: `${companionSlug}/${filePath}`
  companionSlug: string
  filePath: string
  blob: Blob
  mimeType: string
}

let dbInstance: IDBDatabase | null = null

// Track created blob URLs for cleanup
const blobUrlCache: Map<string, string[]> = new Map()

/**
 * Open database connection (singleton pattern)
 */
async function getDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

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

      // Companions store - metadata
      if (!db.objectStoreNames.contains(COMPANIONS_STORE)) {
        const companionsStore = db.createObjectStore(COMPANIONS_STORE, { keyPath: 'slug' })
        companionsStore.createIndex('by-lastUsed', 'lastUsedAt', { unique: false })
        log.log(' Companions store created')
      }

      // Files store - binary blobs
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        const filesStore = db.createObjectStore(FILES_STORE, { keyPath: 'id' })
        filesStore.createIndex('by-companion', 'companionSlug', { unique: false })
        log.log(' Files store created')
      }
    }
  })
}

/**
 * Initialize the database (call on extension startup)
 */
export async function initCompanionDB(): Promise<IDBDatabase> {
  return getDB()
}

// ============================================================================
// Companion Metadata Operations
// ============================================================================

/**
 * Save companion metadata
 */
export async function saveCompanionMetadata(companion: StoredCompanion): Promise<void> {
  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([COMPANIONS_STORE], 'readwrite')
    const store = transaction.objectStore(COMPANIONS_STORE)
    const request = store.put(companion)

    request.onsuccess = () => {
      log.log(` Saved companion metadata: ${companion.slug}`)
      resolve()
    }
    request.onerror = () => {
      log.error(' Failed to save companion:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Get companion metadata by slug
 */
export async function getCompanionMetadata(slug: string): Promise<StoredCompanion | null> {
  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([COMPANIONS_STORE], 'readonly')
    const store = transaction.objectStore(COMPANIONS_STORE)
    const request = store.get(slug)

    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => {
      log.error(' Failed to get companion:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Get all installed companions
 */
export async function getInstalledCompanions(): Promise<StoredCompanion[]> {
  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([COMPANIONS_STORE], 'readonly')
    const store = transaction.objectStore(COMPANIONS_STORE)
    const request = store.getAll()

    request.onsuccess = () => {
      const companions = request.result as StoredCompanion[]
      // Sort by lastUsedAt (most recent first)
      companions.sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      resolve(companions)
    }
    request.onerror = () => {
      log.error(' Failed to get companions:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Check if a companion is installed
 */
export async function isCompanionInstalled(slug: string): Promise<boolean> {
  const companion = await getCompanionMetadata(slug)
  return companion !== null
}

/**
 * Update companion's lastUsedAt timestamp
 */
export async function markCompanionUsed(slug: string): Promise<void> {
  const companion = await getCompanionMetadata(slug)
  if (!companion) return

  companion.lastUsedAt = Date.now()
  await saveCompanionMetadata(companion)
}

/**
 * Delete companion metadata
 */
export async function deleteCompanionMetadata(slug: string): Promise<void> {
  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([COMPANIONS_STORE], 'readwrite')
    const store = transaction.objectStore(COMPANIONS_STORE)
    const request = store.delete(slug)

    request.onsuccess = () => {
      log.log(` Deleted companion metadata: ${slug}`)
      resolve()
    }
    request.onerror = () => {
      log.error(' Failed to delete companion:', request.error)
      reject(request.error)
    }
  })
}

// ============================================================================
// File Blob Operations
// ============================================================================

/**
 * Generate file ID from companion slug and file path
 */
function makeFileId(companionSlug: string, filePath: string): string {
  return `${companionSlug}/${filePath}`
}

/**
 * Save a file blob
 */
export async function saveCompanionFile(
  companionSlug: string,
  filePath: string,
  blob: Blob,
  mimeType: string
): Promise<void> {
  const db = await getDB()

  const file: StoredFile = {
    id: makeFileId(companionSlug, filePath),
    companionSlug,
    filePath,
    blob,
    mimeType,
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([FILES_STORE], 'readwrite')
    const store = transaction.objectStore(FILES_STORE)
    const request = store.put(file)

    request.onsuccess = () => resolve()
    request.onerror = () => {
      log.error(' Failed to save file:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Get a file blob
 */
export async function getCompanionFile(
  companionSlug: string,
  filePath: string
): Promise<StoredFile | null> {
  const db = await getDB()
  const id = makeFileId(companionSlug, filePath)

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([FILES_STORE], 'readonly')
    const store = transaction.objectStore(FILES_STORE)
    const request = store.get(id)

    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => {
      log.error(' Failed to get file:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Get a blob URL for a companion file
 * Creates an object URL that can be used to load the file
 * Blob URLs are cached for cleanup when switching companions
 */
export async function getCompanionFileUrl(
  companionSlug: string,
  filePath: string
): Promise<string | null> {
  const file = await getCompanionFile(companionSlug, filePath)
  if (!file) return null

  const blobUrl = URL.createObjectURL(file.blob)

  // Track the blob URL for cleanup
  const existing = blobUrlCache.get(companionSlug) || []
  existing.push(blobUrl)
  blobUrlCache.set(companionSlug, existing)

  return blobUrl
}

/**
 * Revoke all blob URLs for a companion
 * Call this when switching to a different companion to prevent memory leaks
 */
export function revokeCompanionBlobUrls(companionSlug: string): number {
  const urls = blobUrlCache.get(companionSlug)
  if (!urls || urls.length === 0) return 0

  for (const url of urls) {
    URL.revokeObjectURL(url)
  }

  const count = urls.length
  blobUrlCache.delete(companionSlug)
  log.log(` Revoked ${count} blob URLs for ${companionSlug}`)
  return count
}

/**
 * Revoke all blob URLs for all companions
 * Call this for full cleanup
 */
export function revokeAllBlobUrls(): number {
  let total = 0
  for (const [slug, urls] of blobUrlCache.entries()) {
    for (const url of urls) {
      URL.revokeObjectURL(url)
    }
    total += urls.length
  }

  blobUrlCache.clear()
  if (total > 0) {
    log.log(` Revoked ${total} total blob URLs`)
  }
  return total
}

/**
 * Get all files for a companion
 */
export async function getCompanionFiles(companionSlug: string): Promise<StoredFile[]> {
  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([FILES_STORE], 'readonly')
    const store = transaction.objectStore(FILES_STORE)
    const index = store.index('by-companion')
    const request = index.getAll(companionSlug)

    request.onsuccess = () => resolve(request.result as StoredFile[])
    request.onerror = () => {
      log.error(' Failed to get companion files:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Delete all files for a companion
 */
export async function deleteCompanionFiles(companionSlug: string): Promise<number> {
  const files = await getCompanionFiles(companionSlug)
  if (files.length === 0) return 0

  const db = await getDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([FILES_STORE], 'readwrite')
    const store = transaction.objectStore(FILES_STORE)

    let deleted = 0
    let hasError = false

    for (const file of files) {
      const request = store.delete(file.id)

      request.onsuccess = () => {
        deleted++
        if (deleted === files.length && !hasError) {
          log.log(` Deleted ${deleted} files for ${companionSlug}`)
          resolve(deleted)
        }
      }

      request.onerror = () => {
        if (!hasError) {
          hasError = true
          log.error(' Failed to delete file:', request.error)
          reject(request.error)
        }
      }
    }
  })
}

// ============================================================================
// Combined Operations
// ============================================================================

/**
 * Delete a companion and all its files
 */
export async function deleteCompanion(slug: string): Promise<void> {
  await deleteCompanionFiles(slug)
  await deleteCompanionMetadata(slug)
  log.log(` Deleted companion: ${slug}`)
}

/**
 * Get storage usage for companions
 */
export async function getStorageUsage(): Promise<{
  companionCount: number
  totalSizeBytes: number
}> {
  const companions = await getInstalledCompanions()

  return {
    companionCount: companions.length,
    totalSizeBytes: companions.reduce((sum, c) => sum + c.packageSizeBytes, 0),
  }
}
