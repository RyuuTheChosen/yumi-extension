// Unified error taxonomy and Result wrapper for Yumi network/provider operations

import { createLogger } from './debug'

const log = createLogger('Errors')

export type ErrorCategory =
  | 'network'
  | 'auth'
  | 'rate_limit'
  | 'provider_model'
  | 'provider_other'
  | 'transient'
  | 'abort'
  | 'parse'
  | 'unknown'

export interface YumiError {
  category: ErrorCategory
  code?: string
  message: string
  status?: number
  retriable: boolean
  attempt: number
  maxAttempts: number
  timestamp: number
  cause?: unknown
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: YumiError }

export function makeError(partial: Partial<YumiError> & Pick<YumiError, 'category' | 'message'>): YumiError {
  const now = Date.now()
  return {
    code: undefined,
    status: undefined,
    retriable: false,
    attempt: 1,
    maxAttempts: 1,
    timestamp: now,
    ...partial,
  }
}

// Classify HTTP response into a YumiError if not ok
export async function classifyHttpError(
  res: Response,
  attempt: number,
  maxAttempts: number
): Promise<YumiError> {
  let message = ''
  try {
    const json = await res.clone().json().catch(() => undefined)
    message = json?.error?.message || json?.message || JSON.stringify(json)
  } catch {
    try {
      message = await res.text()
    } catch {
      // noop
    }
  }
  message = message || `HTTP ${res.status}`

  const status = res.status
  let category: ErrorCategory = 'unknown'
  let retriable = false
  let code: string | undefined

  if (status === 401 || status === 403) {
    category = 'auth'
    retriable = false
    code = `HTTP_${status}`
  } else if (status === 429) {
    category = 'rate_limit'
    retriable = true
    code = 'HTTP_429'
  } else if (status >= 500 && status <= 599) {
    category = 'transient'
    retriable = true
    code = `HTTP_${status}`
  } else if (status === 400) {
    const lower = message.toLowerCase()
    if (lower.includes('model') && (lower.includes('not') && (lower.includes('exist') || lower.includes('found')))) {
      category = 'provider_model'
      retriable = false
      code = 'MODEL_INVALID'
    } else {
      category = 'provider_other'
      retriable = false
      code = 'HTTP_400'
    }
  } else if (status >= 400 && status <= 499) {
    category = 'provider_other'
    retriable = false
    code = `HTTP_${status}`
  }

  return makeError({ category, message, status, retriable, attempt, maxAttempts, code })
}

export function fromException(e: unknown, attempt: number, maxAttempts: number): YumiError {
  // AbortError detection across browsers
  const name = (e as any)?.name || ''
  const message = (e as any)?.message || String(e)

  if (name === 'AbortError' || message.toLowerCase().includes('abort')) {
    return makeError({
      category: 'abort',
      message: 'Request aborted',
      retriable: false,
      attempt,
      maxAttempts,
      cause: e,
    })
  }

  // Generic network-ish failures
  const lower = message.toLowerCase()
  const networkIndicators = ['networkerror', 'failed to fetch', 'net::', 'dns', 'ssl', 'timed out', 'timeout']
  if (networkIndicators.some((k) => lower.includes(k))) {
    return makeError({
      category: 'network',
      message,
      retriable: true,
      attempt,
      maxAttempts,
      cause: e,
    })
  }

  return makeError({
    category: 'unknown',
    message,
    retriable: false,
    attempt,
    maxAttempts,
    cause: e,
  })
}

export function backoffDelay(attempt: number, baseMs = 250, jitter = 0.2): number {
  const expo = baseMs * Math.pow(2, Math.max(0, attempt - 1))
  const rand = 1 + (Math.random() * 2 - 1) * jitter // 1 ± jitter
  return Math.round(expo * rand)
}

/**
 * Simple Error Handling Utilities
 *
 * These utilities provide consistent error handling across the codebase
 * without requiring retry logic or complex error categorization.
 */

/**
 * Convert an unknown exception to an Error object
 *
 * @param err - Unknown error from catch block
 * @returns Error object with message
 *
 * @example
 * ```typescript
 * try {
 *   // operation
 * } catch (err) {
 *   const error = toError(err)
 *   console.error(error.message)
 * }
 * ```
 */
export function toError(err: unknown): Error {
  if (err instanceof Error) {
    return err
  }
  if (typeof err === 'string') {
    return new Error(err)
  }
  if (err && typeof err === 'object' && 'message' in err) {
    return new Error(String(err.message))
  }
  return new Error('Unknown error')
}

/**
 * Log an error with context
 *
 * @param context - Context string (e.g., "Background", "ChatOverlay")
 * @param message - Error message
 * @param err - Unknown error from catch block
 *
 * @example
 * ```typescript
 * try {
 *   await fetchData()
 * } catch (err) {
 *   logError('DataService', 'Failed to fetch data', err)
 * }
 * ```
 */
export function logError(context: string, message: string, err: unknown): void {
  const error = toError(err)
  log.error(`[${context}] ${message}:`, error.message)
  if (error.stack) {
    log.error(error.stack)
  }
}

/**
 * Create an error message from an unknown error
 *
 * @param err - Unknown error from catch block
 * @param fallback - Fallback message if error cannot be extracted
 * @returns Error message string
 *
 * @example
 * ```typescript
 * catch (err) {
 *   sendResponse({
 *     success: false,
 *     error: getErrorMessage(err, 'Operation failed')
 *   })
 * }
 * ```
 */
export function getErrorMessage(err: unknown, fallback = 'Unknown error'): string {
  if (err instanceof Error) {
    return err.message
  }
  if (typeof err === 'string') {
    return err
  }
  if (err && typeof err === 'object' && 'message' in err) {
    return String(err.message)
  }
  return fallback
}

/**
 * Check if an error is an AbortError
 *
 * @param err - Unknown error from catch block
 * @returns True if error is an AbortError
 *
 * @example
 * ```typescript
 * catch (err) {
 *   if (isAbortError(err)) {
 *     // User canceled, don't show error
 *     return
 *   }
 *   showError(err)
 * }
 * ```
 */
export function isAbortError(err: unknown): boolean {
  if (err instanceof Error && err.name === 'AbortError') {
    return true
  }
  const message = getErrorMessage(err, '').toLowerCase()
  return message.includes('abort')
}
