// Unified error taxonomy and Result wrapper for Yumi network/provider operations

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
    const json = await res.clone().json().catch(() => undefined as any)
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
