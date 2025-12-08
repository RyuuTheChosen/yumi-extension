/**
 * Companion Package Verification (Browser-Compatible)
 *
 * Uses Web Crypto API for RSA-SHA256 signature verification.
 * Prevents MITM attacks and ensures package authenticity.
 */

import { PACKAGE_VERIFICATION_PUBLIC_KEY, PACKAGE_SIGNING_ENABLED } from './publicKey'
import { createLogger } from '../core/debug'

const log = createLogger('PackageVerification')

/**
 * Convert PEM public key to CryptoKey
 */
async function importPublicKey(pemKey: string): Promise<CryptoKey> {
  // Remove PEM headers and whitespace
  const pemContents = pemKey
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s/g, '')

  // Convert base64 to ArrayBuffer
  const binaryDer = atob(pemContents)
  const bytes = new Uint8Array(binaryDer.length)
  for (let i = 0; i < binaryDer.length; i++) {
    bytes[i] = binaryDer.charCodeAt(i)
  }

  // Import as CryptoKey
  return await crypto.subtle.importKey(
    'spki',
    bytes.buffer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256'
    },
    false,
    ['verify']
  )
}

/**
 * Verify package signature using Web Crypto API
 *
 * @param packageBuffer - Package ZIP file as Uint8Array
 * @param signatureBase64 - Base64-encoded signature
 * @returns true if signature is valid, false otherwise
 */
export async function verifyPackageSignature(
  packageBuffer: Uint8Array,
  signatureBase64: string
): Promise<boolean> {
  try {
    // Import public key
    const publicKey = await importPublicKey(PACKAGE_VERIFICATION_PUBLIC_KEY)

    // Decode signature from base64
    const signatureBinary = atob(signatureBase64)
    const signature = new Uint8Array(signatureBinary.length)
    for (let i = 0; i < signatureBinary.length; i++) {
      signature[i] = signatureBinary.charCodeAt(i)
    }

    // Verify signature
    const isValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      signature.buffer as ArrayBuffer,
      packageBuffer.buffer as ArrayBuffer
    )

    return isValid
  } catch (error) {
    log.error('[verifyPackageSignature] Verification error:', error)
    return false
  }
}

/**
 * Verify companion package before installation
 *
 * @param packageBuffer - Package ZIP file
 * @param signature - Package signature from API (optional)
 * @returns true if verification passes or signing is disabled
 * @throws Error if signature verification fails when enabled
 */
export async function verifyCompanionPackage(
  packageBuffer: Uint8Array,
  signature?: string | null
): Promise<void> {
  // Skip verification if signing is not enabled
  if (!PACKAGE_SIGNING_ENABLED) {
    log.log('[verifyCompanionPackage] Package signing not enabled, skipping verification')
    return
  }

  // Require signature when signing is enabled
  if (!signature) {
    throw new Error('Package signature missing. This companion may be compromised.')
  }

  // Verify signature
  log.log('[verifyCompanionPackage] Verifying package signature...')
  const isValid = await verifyPackageSignature(packageBuffer, signature)

  if (!isValid) {
    throw new Error('Package signature verification failed. This companion may be tampered with.')
  }

  log.log('[verifyCompanionPackage] Package signature verified successfully')
}
