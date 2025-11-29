import { describe, it, expect } from 'vitest'
import { encryptApiKey, decryptApiKey, maskKey } from '../../lib/crypto'

describe('crypto utils', () => {
  it('encrypts and decrypts API key round-trip', async () => {
    const plain = 'sk-test-abc1234567890'
    const enc = await encryptApiKey(plain)
    const dec = await decryptApiKey(enc)
    expect(dec).toBe(plain)
  })

  it('masks keys with tail visible', () => {
    const masked = maskKey('sk-abc1234567890', 4)
    expect(masked.endsWith('7890')).toBe(true)
  })
})
