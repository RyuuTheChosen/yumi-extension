/**
 * Chrome Runtime Messaging Utilities
 *
 * Provides a unified, type-safe wrapper for chrome.runtime.sendMessage
 * with timeout support to prevent indefinite hangs.
 */

import { createLogger } from './debug'

const log = createLogger('Messaging')

/** Default timeout for message operations (5 seconds) */
const DEFAULT_TIMEOUT_MS = 5000

/** Error thrown when a message times out */
export class MessageTimeoutError extends Error {
  constructor(type: string, timeoutMs: number) {
    super(`Message '${type}' timed out after ${timeoutMs}ms`)
    this.name = 'MessageTimeoutError'
  }
}

/** Error thrown when chrome.runtime.lastError is set */
export class ChromeRuntimeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChromeRuntimeError'
  }
}

/** Standard message response shape */
export interface MessageResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Send a message to the background script with timeout protection.
 *
 * @param type - The message type identifier
 * @param payload - Optional payload data
 * @param timeoutMs - Timeout in milliseconds (default: 5000)
 * @returns Promise resolving to the response data
 * @throws MessageTimeoutError if the message times out
 * @throws ChromeRuntimeError if chrome.runtime.lastError is set
 * @throws Error if the response indicates failure
 */
export async function sendMessage<T = unknown>(
  type: string,
  payload?: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new MessageTimeoutError(type, timeoutMs))
    }, timeoutMs)

    try {
      chrome.runtime.sendMessage({ type, payload }, (response: MessageResponse<T>) => {
        clearTimeout(timeoutId)

        if (chrome.runtime.lastError) {
          reject(new ChromeRuntimeError(chrome.runtime.lastError.message ?? 'Unknown runtime error'))
          return
        }

        if (!response) {
          reject(new Error(`No response received for message '${type}'`))
          return
        }

        if (!response.success) {
          reject(new Error(response.error ?? `Message '${type}' failed`))
          return
        }

        resolve(response.data as T)
      })
    } catch (error) {
      clearTimeout(timeoutId)
      reject(error)
    }
  })
}

/**
 * Send a message and return null on failure instead of throwing.
 * Useful for optional operations where failure is acceptable.
 *
 * @param type - The message type identifier
 * @param payload - Optional payload data
 * @param timeoutMs - Timeout in milliseconds (default: 5000)
 * @returns Promise resolving to the response data or null on failure
 */
export async function sendMessageSafe<T = unknown>(
  type: string,
  payload?: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<T | null> {
  try {
    return await sendMessage<T>(type, payload, timeoutMs)
  } catch (error) {
    log.warn(`Message '${type}' failed:`, error)
    return null
  }
}

/**
 * Send a message with retry logic for transient failures.
 *
 * @param type - The message type identifier
 * @param payload - Optional payload data
 * @param options - Retry options
 * @returns Promise resolving to the response data
 */
export async function sendMessageWithRetry<T = unknown>(
  type: string,
  payload?: unknown,
  options: {
    maxRetries?: number
    timeoutMs?: number
    retryDelayMs?: number
  } = {}
): Promise<T> {
  const { maxRetries = 3, timeoutMs = DEFAULT_TIMEOUT_MS, retryDelayMs = 1000 } = options

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await sendMessage<T>(type, payload, timeoutMs)
    } catch (error) {
      lastError = error as Error

      /** Don't retry on non-transient errors */
      if (error instanceof Error && error.message.includes('failed')) {
        throw error
      }

      if (attempt < maxRetries) {
        log.warn(`Message '${type}' attempt ${attempt + 1} failed, retrying in ${retryDelayMs}ms...`)
        await new Promise(resolve => setTimeout(resolve, retryDelayMs))
      }
    }
  }

  throw lastError ?? new Error(`Message '${type}' failed after ${maxRetries} retries`)
}

/**
 * Check if the extension context is still valid.
 * Useful before sending messages to avoid errors.
 */
export function isExtensionContextValid(): boolean {
  try {
    return typeof chrome !== 'undefined' && chrome.runtime && !!chrome.runtime.id
  } catch {
    return false
  }
}
