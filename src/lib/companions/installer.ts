/**
 * Companion Installer
 *
 * Downloads companion packages from the Hub API, verifies checksums and signatures,
 * extracts files, and stores them in IndexedDB.
 */

import JSZip from 'jszip'
import { createLogger } from '../core/debug'

const log = createLogger('CompanionInstaller')
import {
  saveCompanionMetadata,
  saveCompanionFile,
  deleteCompanion,
  getCompanionMetadata,
  type StoredCompanion,
} from './db'
import {
  companionManifestSchema,
  companionPersonalitySchema,
  type CompanionManifest,
  type CompanionPersonality,
} from './types'
import { verifyCompanionPackage } from './verification'

// Installation progress callback
export interface InstallProgress {
  stage: 'downloading' | 'verifying' | 'extracting' | 'storing' | 'complete' | 'error'
  progress: number  // 0-100
  message: string
  error?: string
}

export type ProgressCallback = (progress: InstallProgress) => void

// Configuration
const MAX_PACKAGE_SIZE_MB = 50
const MAX_PACKAGE_SIZE_BYTES = MAX_PACKAGE_SIZE_MB * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 180000 // 3 minutes for larger packages

/**
 * Calculate SHA-256 checksum of an ArrayBuffer
 */
async function calculateChecksum(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Determine MIME type from file extension
 */
function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  const mimeTypes: Record<string, string> = {
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'moc3': 'application/octet-stream',
    'exp3': 'application/json',
    'model3': 'application/json',
    'physics3': 'application/json',
    'cdi3': 'application/json',
    'vrm': 'model/gltf-binary',
  }
  return mimeTypes[ext || ''] || 'application/octet-stream'
}

/**
 * Check if a companion is already installed with the same version
 */
export async function checkInstalledVersion(
  slug: string,
  expectedChecksum: string
): Promise<{ installed: boolean; sameVersion: boolean; currentVersion?: string }> {
  const existing = await getCompanionMetadata(slug)
  if (!existing) {
    return { installed: false, sameVersion: false }
  }

  // Same version if checksums match
  const sameVersion = existing.checksumSha256 === expectedChecksum
  return {
    installed: true,
    sameVersion,
    currentVersion: existing.version,
  }
}

/**
 * Install a companion from a download URL
 * Set forceReinstall=true to reinstall even if the same version is installed
 */
export async function installCompanion(
  slug: string,
  downloadUrl: string,
  expectedChecksum: string,
  onProgress?: ProgressCallback,
  forceReinstall: boolean = false,
  packageSignature?: string | null
): Promise<StoredCompanion> {
  const report = (stage: InstallProgress['stage'], progress: number, message: string, error?: string) => {
    onProgress?.({ stage, progress, message, error })
  }

  // Check for duplicate installation
  const existingStatus = await checkInstalledVersion(slug, expectedChecksum)
  if (existingStatus.installed && existingStatus.sameVersion && !forceReinstall) {
    log.log(`Companion ${slug} already installed with same version, skipping download`)
    // Return the existing companion data
    const existing = await getCompanionMetadata(slug)
    if (existing) {
      report('complete', 100, `${existing.manifest.name} is already up to date`)
      return existing
    }
  }

  if (existingStatus.installed && !existingStatus.sameVersion) {
    log.log(`Updating companion ${slug} from v${existingStatus.currentVersion}`)
  }

  // Create abort controller for timeout
  const abortController = new AbortController()
  const timeoutId = setTimeout(() => {
    abortController.abort()
  }, DOWNLOAD_TIMEOUT_MS)

  try {
    // Stage 1: Download
    report('downloading', 0, `Downloading ${slug}...`)

    // First, check package size with HEAD request
    try {
      const headResponse = await fetch(downloadUrl, {
        method: 'HEAD',
        signal: abortController.signal,
      })
      const contentLength = headResponse.headers.get('content-length')
      if (contentLength) {
        const size = parseInt(contentLength, 10)
        if (size > MAX_PACKAGE_SIZE_BYTES) {
          throw new Error(`Package too large: ${(size / 1024 / 1024).toFixed(1)}MB (max ${MAX_PACKAGE_SIZE_MB}MB)`)
        }
      }
    } catch (headError) {
      // HEAD might fail on some servers, continue with GET
      if (headError instanceof Error && headError.name === 'AbortError') {
        throw new Error('Download timed out. Please check your connection and try again.')
      }
      log.warn('HEAD request failed, continuing with GET:', headError)
    }

    const response = await fetch(downloadUrl, {
      signal: abortController.signal,
    })
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`)
    }

    const contentLength = response.headers.get('content-length')
    const totalSize = contentLength ? parseInt(contentLength, 10) : 0

    // Validate size from GET response if HEAD was skipped
    if (totalSize > MAX_PACKAGE_SIZE_BYTES) {
      throw new Error(`Package too large: ${(totalSize / 1024 / 1024).toFixed(1)}MB (max ${MAX_PACKAGE_SIZE_MB}MB)`)
    }

    // Stream the download to track progress
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Failed to get response reader')
    }

    const chunks: Uint8Array[] = []
    let receivedLength = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      chunks.push(value)
      receivedLength += value.length

      // Check size limit during download
      if (receivedLength > MAX_PACKAGE_SIZE_BYTES) {
        reader.cancel()
        throw new Error(`Package too large: exceeds ${MAX_PACKAGE_SIZE_MB}MB limit`)
      }

      if (totalSize > 0) {
        const percent = Math.round((receivedLength / totalSize) * 30) // 0-30%
        report('downloading', percent, `Downloading... ${Math.round(receivedLength / 1024)}KB`)
      }
    }

    // Clear timeout since download completed
    clearTimeout(timeoutId)

    const packageBuffer = new Uint8Array(receivedLength)
    let position = 0
    for (const chunk of chunks) {
      packageBuffer.set(chunk, position)
      position += chunk.length
    }

    report('downloading', 30, `Downloaded ${Math.round(receivedLength / 1024)}KB`)

    // Stage 2: Verify checksum and signature
    report('verifying', 35, 'Verifying checksum...')

    const actualChecksum = await calculateChecksum(packageBuffer.buffer)
    if (actualChecksum !== expectedChecksum) {
      throw new Error(`Checksum mismatch: expected ${expectedChecksum.slice(0, 8)}..., got ${actualChecksum.slice(0, 8)}...`)
    }

    // Verify package signature (if signing is enabled)
    report('verifying', 38, 'Verifying package signature...')
    try {
      await verifyCompanionPackage(packageBuffer, packageSignature)
    } catch (signatureError) {
      throw new Error(`Package verification failed: ${signatureError instanceof Error ? signatureError.message : 'Unknown error'}`)
    }

    report('verifying', 40, 'Checksum verified')

    // Stage 3: Extract ZIP
    report('extracting', 45, 'Extracting package...')

    const zip = await JSZip.loadAsync(packageBuffer)
    const files = Object.keys(zip.files)

    // Find and validate companion.json
    const manifestFile = zip.file('companion.json')
    if (!manifestFile) {
      throw new Error('Invalid package: missing companion.json')
    }

    const manifestText = await manifestFile.async('text')
    const manifestJson = JSON.parse(manifestText)
    const manifest: CompanionManifest = companionManifestSchema.parse(manifestJson)

    // Find and validate personality.json
    const personalityPath = manifest.personality || 'personality.json'
    const personalityFile = zip.file(personalityPath)
    if (!personalityFile) {
      throw new Error(`Invalid package: missing ${personalityPath}`)
    }

    const personalityText = await personalityFile.async('text')
    const personalityJson = JSON.parse(personalityText)
    const personality: CompanionPersonality = companionPersonalitySchema.parse(personalityJson)

    report('extracting', 55, `Found ${files.length} files`)

    // Stage 4: Store files in IndexedDB
    report('storing', 60, 'Storing files...')

    let storedCount = 0
    const totalFiles = files.filter(f => !zip.files[f].dir).length

    for (const filePath of files) {
      const file = zip.files[filePath]
      if (file.dir) continue // Skip directories

      const blob = await file.async('blob')
      const mimeType = getMimeType(filePath)

      await saveCompanionFile(slug, filePath, blob, mimeType)

      storedCount++
      const percent = 60 + Math.round((storedCount / totalFiles) * 35) // 60-95%
      report('storing', percent, `Stored ${storedCount}/${totalFiles} files`)
    }

    // Stage 5: Save metadata
    const companion: StoredCompanion = {
      slug,
      manifest,
      personality,
      version: manifest.version,
      checksumSha256: expectedChecksum,
      downloadedAt: Date.now(),
      lastUsedAt: Date.now(),
      packageSizeBytes: receivedLength,
    }

    await saveCompanionMetadata(companion)

    report('complete', 100, `Installed ${manifest.name}`)

    log.log(`Successfully installed companion: ${slug}`)
    return companion

  } catch (error) {
    // Clear timeout on error
    clearTimeout(timeoutId)

    // Handle abort/timeout specifically
    let message: string
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        message = 'Download timed out. Please check your connection and try again.'
      } else {
        message = error.message
      }
    } else {
      message = 'Unknown error'
    }

    report('error', 0, 'Installation failed', message)

    // Clean up partial installation
    try {
      await deleteCompanion(slug)
    } catch {
      // Ignore cleanup errors
    }

    throw new Error(message)
  }
}

/**
 * Uninstall a companion
 */
export async function uninstallCompanion(slug: string): Promise<void> {
  await deleteCompanion(slug)
  log.log(`Uninstalled companion: ${slug}`)
}

/**
 * Check if a companion update is available
 */
export async function checkForUpdate(
  slug: string,
  currentVersion: string,
  hubApiUrl: string,
  accessToken: string
): Promise<{ available: boolean; newVersion?: string }> {
  try {
    const response = await fetch(`${hubApiUrl}/v1/companions/${slug}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      return { available: false }
    }

    const data = await response.json()
    const remoteVersion = data.version

    // Simple version comparison (assumes semver-like format)
    if (remoteVersion !== currentVersion) {
      return { available: true, newVersion: remoteVersion }
    }

    return { available: false }
  } catch {
    return { available: false }
  }
}
