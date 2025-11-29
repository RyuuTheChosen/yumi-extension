// AES-GCM encryption helpers for storing sensitive user API keys locally.
// Key derivation: uses PBKDF2 on a static label + optional user-provided salt segment (future).
// For MVP we derive from a constant plus chrome.runtime.id to lightly bind to install.

const PBKDF2_ITERATIONS = 120_000
const KEY_LENGTH = 32
const ENCODER = new TextEncoder()
const DECODER = new TextDecoder()

function getBaseSalt(): ArrayBuffer {
  // Use extension runtime id when available, else fall back for tests/node
  const extId = (globalThis as any)?.chrome?.runtime?.id ?? 'dev'
  const base = `yumi-ext-${extId}-v1`
  return ENCODER.encode(base).buffer
}

async function deriveKey(): Promise<CryptoKey> {
  const salt = getBaseSalt()
  const material = await crypto.subtle.importKey('raw', ENCODER.encode('yumi-api-key'), 'PBKDF2', false, ['deriveBits', 'deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: KEY_LENGTH * 8 },
    false,
    ['encrypt', 'decrypt']
  )
}

export interface EncryptedBlob {
  iv: string // base64
  data: string // base64 ciphertext
  tag?: string // reserved (not used; AES-GCM includes tag in ciphertext)
  alg: 'AES-GCM'
  v: 1
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function fromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

export async function encryptApiKey(plain: string): Promise<EncryptedBlob> {
  const key = await deriveKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, ENCODER.encode(plain))
  return { iv: toBase64(iv.buffer), data: toBase64(ct), alg: 'AES-GCM', v: 1 }
}

export async function decryptApiKey(blob: EncryptedBlob | null): Promise<string | null> {
  if (!blob) return null
  if (blob.alg !== 'AES-GCM') return null
  try {
    const key = await deriveKey()
  const iv = new Uint8Array(fromBase64(blob.iv))
  const dataBuf = fromBase64(blob.data)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, dataBuf)
    return DECODER.decode(pt)
  } catch {
    return null
  }
}

export function maskKey(key: string | null, visible = 4): string {
  if (!key) return ''
  if (key.length <= visible) return key
  const tail = key.slice(-visible)
  return `••••••••••••${tail}`
}
