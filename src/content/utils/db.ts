/**
 * IndexedDB Storage for Scoped Chat Messages
 * 
 * Uses native IndexedDB API (no external dependencies)
 * Stores messages per scope with efficient querying
 */

import type { Scope } from './scopes'

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  ts: number
  scopeId: string
  
  meta?: {
    url?: string
    title?: string
    tabId?: number
    tokensIn?: number
    tokensOut?: number
    model?: string
    proactive?: boolean
  }
  
  status?: 'final' | 'streaming' | 'error'
}

export interface Thread {
  id: string
  scope: Scope
  messages: Message[]
  lastTs: number
  summaryPreview: string
  messageCount: number
  charCount: number
  private: boolean
}

const DB_NAME = 'yumi-chat'
const DB_VERSION = 1
const MESSAGES_STORE = 'messages'
const THREADS_STORE = 'threads'

let dbInstance: IDBDatabase | null = null

/**
 * Open database connection (singleton pattern)
 */
async function getDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      console.error('[DB] Failed to open database:', request.error)
      reject(request.error)
    }

    request.onsuccess = () => {
      dbInstance = request.result
      console.log('[DB] ✅ Database opened')
      resolve(dbInstance)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      // Messages store with indexes
      if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
        const messageStore = db.createObjectStore(MESSAGES_STORE, { keyPath: 'id' })
        messageStore.createIndex('by-scope', 'scopeId', { unique: false })
        messageStore.createIndex('by-timestamp', 'ts', { unique: false })
        console.log('[DB] ✅ Messages store created')
      }

      // Threads store (metadata only)
      if (!db.objectStoreNames.contains(THREADS_STORE)) {
        db.createObjectStore(THREADS_STORE, { keyPath: 'id' })
        console.log('[DB] ✅ Threads store created')
      }
    }
  })
}

/**
 * Get all messages for a specific scope
 */
export async function getThreadMessages(scopeId: string): Promise<Message[]> {
  const db = await getDB()
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([MESSAGES_STORE], 'readonly')
    const store = transaction.objectStore(MESSAGES_STORE)
    const index = store.index('by-scope')
    const request = index.getAll(scopeId)

    request.onsuccess = () => {
      const messages = request.result as Message[]
      // Sort by timestamp ascending
      messages.sort((a, b) => a.ts - b.ts)
      resolve(messages)
    }

    request.onerror = () => {
      console.error('[DB] Failed to get messages:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Add a single message
 */
export async function addMessage(message: Message): Promise<void> {
  const db = await getDB()
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([MESSAGES_STORE], 'readwrite')
    const store = transaction.objectStore(MESSAGES_STORE)
    const request = store.add(message)

    request.onsuccess = () => resolve()
    request.onerror = () => {
      console.error('[DB] Failed to add message:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Update an existing message (for streaming finalization)
 */
export async function updateMessage(message: Message): Promise<void> {
  const db = await getDB()
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([MESSAGES_STORE], 'readwrite')
    const store = transaction.objectStore(MESSAGES_STORE)
    const request = store.put(message)

    request.onsuccess = () => resolve()
    request.onerror = () => {
      console.error('[DB] Failed to update message:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Delete a message by ID
 */
export async function deleteMessage(messageId: string): Promise<void> {
  const db = await getDB()
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([MESSAGES_STORE], 'readwrite')
    const store = transaction.objectStore(MESSAGES_STORE)
    const request = store.delete(messageId)

    request.onsuccess = () => resolve()
    request.onerror = () => {
      console.error('[DB] Failed to delete message:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Prune old messages based on character budget
 * Keeps most recent messages within budget
 */
export async function pruneOldMessages(
  scopeId: string,
  charBudget: number = 16000
): Promise<number> {
  const messages = await getThreadMessages(scopeId)
  
  // Calculate which messages to keep
  let totalChars = 0
  const toKeep: Message[] = []
  const toDelete: Message[] = []
  
  // Iterate backwards (most recent first)
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    totalChars += msg.content.length
    
    if (totalChars <= charBudget) {
      toKeep.unshift(msg)
    } else {
      toDelete.push(msg)
    }
  }
  
  // Delete old messages
  for (const msg of toDelete) {
    await deleteMessage(msg.id)
  }
  
  console.log(`[DB] Pruned ${toDelete.length} messages from scope ${scopeId}`)
  return toDelete.length
}

/**
 * Get thread metadata
 */
export async function getThread(threadId: string): Promise<Thread | null> {
  const db = await getDB()
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([THREADS_STORE], 'readonly')
    const store = transaction.objectStore(THREADS_STORE)
    const request = store.get(threadId)

    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => {
      console.error('[DB] Failed to get thread:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Save/update thread metadata
 */
export async function saveThread(thread: Thread): Promise<void> {
  const db = await getDB()
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([THREADS_STORE], 'readwrite')
    const store = transaction.objectStore(THREADS_STORE)
    const request = store.put(thread)

    request.onsuccess = () => resolve()
    request.onerror = () => {
      console.error('[DB] Failed to save thread:', request.error)
      reject(request.error)
    }
  })
}

/**
 * Delete all messages in a thread
 */
export async function clearThread(scopeId: string): Promise<void> {
  const messages = await getThreadMessages(scopeId)
  
  for (const msg of messages) {
    await deleteMessage(msg.id)
  }
  
  console.log(`[DB] Cleared ${messages.length} messages from scope ${scopeId}`)
}

/**
 * Get all threads (metadata only, no messages)
 */
export async function getAllThreads(): Promise<Thread[]> {
  const db = await getDB()
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([THREADS_STORE], 'readonly')
    const store = transaction.objectStore(THREADS_STORE)
    const request = store.getAll()

    request.onsuccess = () => {
      const threads = request.result as Thread[]
      // Sort by most recent
      threads.sort((a, b) => b.lastTs - a.lastTs)
      resolve(threads)
    }

    request.onerror = () => {
      console.error('[DB] Failed to get threads:', request.error)
      reject(request.error)
    }
  })
}
