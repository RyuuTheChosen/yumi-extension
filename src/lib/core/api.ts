import { Result, YumiError, classifyHttpError, fromException } from './errors'

export async function signatureHeaders(body: string) {
  const cfg = await chrome.storage.local.get(['clientId', 'clientSecret'])
  const clientId = cfg.clientId || 'dev-client'
  const secret = (cfg.clientSecret || 'dev-secret')
  const ts = Date.now().toString()
  const enc = new TextEncoder()
  const data = enc.encode(ts + body + secret)
  const buf = await crypto.subtle.digest('SHA-256', data)
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('')
  return { headers: { 'Content-Type': 'application/json', 'X-Client-ID': clientId, 'X-Timestamp': ts, 'X-Signature': hex } }
}

// Minimal JSON fetch wrapper returning a Result with typed YumiError on failures
export async function fetchJsonResult<T = any>(
  input: RequestInfo | URL,
  init: RequestInit & { attempt?: number; maxAttempts?: number } = {}
): Promise<Result<T>> {
  const attempt = init.attempt ?? 1
  const maxAttempts = init.maxAttempts ?? 1
  try {
    const res = await fetch(input, init)
    if (!res.ok) {
      const err: YumiError = await classifyHttpError(res, attempt, maxAttempts)
      return { ok: false, error: err }
    }
    const value = (await res.json()) as T
    return { ok: true, value }
  } catch (e) {
    const err = fromException(e, attempt, maxAttempts)
    return { ok: false, error: err }
  }
}

export type { Result, YumiError } from './errors'
