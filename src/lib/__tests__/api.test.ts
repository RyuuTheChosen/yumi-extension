import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { signatureHeaders } from '../core/api'
import { createHash } from 'node:crypto'

const BODY = JSON.stringify({ hello: 'world' })

describe('signatureHeaders', () => {
  const fixedTs = 1700000000000

  beforeEach(async () => {
    vi.spyOn(Date, 'now').mockReturnValue(fixedTs)
    await chrome.storage.local.set({ clientId: 'client-xyz', clientSecret: 'secret-123' } as any)
  })

  afterEach(() => {
    ;(Date.now as any).mockRestore?.()
  })

  it('computes SHA-256 over ts+body+secret and returns header bundle', async () => {
    const { headers } = await signatureHeaders(BODY)
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['X-Client-ID']).toBe('client-xyz')
    expect(headers['X-Timestamp']).toBe(String(fixedTs))
    const expected = createHash('sha256').update(String(fixedTs) + BODY + 'secret-123').digest('hex')
    expect(headers['X-Signature']).toBe(expected)
  })

  it('falls back to dev defaults when storage missing', async () => {
    await chrome.storage.local.remove('clientId')
    await chrome.storage.local.remove('clientSecret')
    const { headers } = await signatureHeaders(BODY)
    expect(headers['X-Client-ID']).toBe('dev-client')
    expect(typeof headers['X-Signature']).toBe('string')
  })
})
