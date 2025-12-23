import {
  companionManifestSchema,
  companionPersonalitySchema,
  companionAnimationsSchema,
  type CompanionManifest,
  type CompanionPersonality,
  type CompanionAnimations,
  type CompanionModelType,
  type LoadedCompanion,
} from './types'
import {
  getCompanionMetadata as getCompanionMetadataDirect,
  getCompanionFileUrl as getCompanionFileUrlDirect,
  markCompanionUsed as markCompanionUsedDirect,
  revokeCompanionBlobUrls,
  saveCompanionMetadata,
  type StoredCompanion,
} from './db'
import { createLogger } from '../core/debug'
import { refreshAccessToken } from '../tts/ttsService'

const log = createLogger('CompanionLoader')

/**
 * Check if we're running in a content script context
 * Content scripts need to use message passing to access IndexedDB
 */
function isContentScript(): boolean {
  return typeof window !== 'undefined' && window.location.protocol !== 'chrome-extension:'
}

/**
 * Get companion metadata - uses message passing for content scripts
 */
async function getCompanionMetadata(slug: string): Promise<StoredCompanion | null> {
  if (!isContentScript()) {
    return getCompanionMetadataDirect(slug)
  }

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'COMPANION_GET_METADATA', payload: { slug } },
      (response) => {
        if (response?.success) {
          resolve(response.metadata)
        } else {
          resolve(null)
        }
      }
    )
  })
}

/**
 * Get companion file URL - uses message passing for content scripts
 */
async function getCompanionFileUrl(slug: string, filePath: string): Promise<string | null> {
  if (!isContentScript()) {
    return getCompanionFileUrlDirect(slug, filePath)
  }

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'COMPANION_GET_FILE_URL', payload: { slug, filePath } },
      (response) => {
        if (response?.success) {
          resolve(response.url)
        } else {
          resolve(null)
        }
      }
    )
  })
}

/**
 * Mark companion as used - uses message passing for content scripts
 */
async function markCompanionUsed(slug: string): Promise<void> {
  if (!isContentScript()) {
    return markCompanionUsedDirect(slug)
  }

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'COMPANION_MARK_USED', payload: { slug } },
      () => resolve()
    )
  })
}

/** Sync check interval in milliseconds (5 minutes) */
const SYNC_CHECK_INTERVAL_MS = 5 * 60 * 1000

/** Track last sync check timestamp per companion */
const lastSyncCheck: Map<string, number> = new Map()

// Default bundled companion ID
const BUNDLED_COMPANION_ID = 'yumi'

// Track the currently loaded companion slug for cleanup
let currentCompanionSlug: string | null = null

/** Cached loaded companion to avoid redundant blob URL creation */
let cachedCompanion: LoadedCompanion | null = null
let cachedCompanionSlug: string | null = null

// Content script blob URL tracking (separate from db.ts which only works in extension context)
const contentScriptBlobUrls: Map<string, string[]> = new Map()

/**
 * Track blob URLs created in content script for cleanup
 */
function trackBlobUrls(slug: string, urls: string[]) {
  if (urls.length === 0) return
  const existing = contentScriptBlobUrls.get(slug) || []
  contentScriptBlobUrls.set(slug, [...existing, ...urls])
}

/**
 * Revoke blob URLs created in content script context
 */
export function revokeContentScriptBlobUrls(slug: string): number {
  const urls = contentScriptBlobUrls.get(slug)
  if (!urls || urls.length === 0) return 0

  for (const url of urls) {
    URL.revokeObjectURL(url)
  }
  const count = urls.length
  contentScriptBlobUrls.delete(slug)
  log.log(`Revoked ${count} content script blob URLs for ${slug}`)
  return count
}

/**
 * Clear the companion cache (call when companion is updated/uninstalled)
 */
export function clearCompanionCache(): void {
  cachedCompanion = null
  cachedCompanionSlug = null
  log.log('Cleared companion cache')
}

/**
 * Get the base directory of the model entry path
 * Example: 'model/model.model3.json' → 'model/'
 */
function getModelBaseDir(modelEntry: string): string {
  const lastSlash = modelEntry.lastIndexOf('/')
  return lastSlash > 0 ? modelEntry.substring(0, lastSlash + 1) : ''
}

/**
 * Detect model type from entry file extension
 * VRM files end in .vrm, Live2D models end in .model3.json
 */
function detectModelType(entry: string, explicitType?: CompanionModelType): CompanionModelType {
  if (explicitType) return explicitType
  if (entry.toLowerCase().endsWith('.vrm')) return 'vrm'
  return 'live2d'
}

/**
 * Extract all file paths referenced in a model.json
 * Returns relative paths as they appear in FileReferences
 */
function extractModelFilePaths(modelJson: any): string[] {
  const paths: string[] = []

  if (modelJson.FileReferences) {
    const refs = modelJson.FileReferences
    if (refs.Moc) paths.push(refs.Moc)
    if (refs.Physics) paths.push(refs.Physics)
    if (refs.Pose) paths.push(refs.Pose)
    if (refs.DisplayInfo) paths.push(refs.DisplayInfo)
    if (refs.Textures) paths.push(...refs.Textures)

    // Expressions
    if (refs.Expressions) {
      for (const expr of refs.Expressions) {
        if (expr.File) paths.push(expr.File)
      }
    }

    // Motions (optional - not all models have motions)
    if (refs.Motions) {
      for (const group of Object.values(refs.Motions)) {
        for (const motion of group as any[]) {
          if (motion.File) paths.push(motion.File)
          if (motion.Sound) paths.push(motion.Sound)
        }
      }
    }
  }

  return paths.filter(Boolean)
}

/**
 * Convert a URL to a blob URL if needed
 * - blob: URLs are returned as-is
 * - data: URLs are converted to blob URLs
 */
function ensureBlobUrl(url: string): string {
  if (url.startsWith('blob:')) {
    return url
  }

  if (url.startsWith('data:')) {
    const [header, base64] = url.split(',')
    const mimeMatch = header.match(/data:([^;]+)/)
    const mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream'

    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }

    const blob = new Blob([bytes], { type: mimeType })
    return URL.createObjectURL(blob)
  }

  return url
}

/**
 * Rewrite model.json paths to use blob URLs
 */
function rewriteModelPaths(modelJson: any, blobUrlMap: Map<string, string>): any {
  const rewritten = JSON.parse(JSON.stringify(modelJson))
  const refs = rewritten.FileReferences
  if (!refs) return rewritten

  if (refs.Moc && blobUrlMap.has(refs.Moc)) refs.Moc = blobUrlMap.get(refs.Moc)
  if (refs.Physics && blobUrlMap.has(refs.Physics)) refs.Physics = blobUrlMap.get(refs.Physics)
  if (refs.Pose && blobUrlMap.has(refs.Pose)) refs.Pose = blobUrlMap.get(refs.Pose)
  if (refs.DisplayInfo && blobUrlMap.has(refs.DisplayInfo)) refs.DisplayInfo = blobUrlMap.get(refs.DisplayInfo)

  if (refs.Textures) {
    refs.Textures = refs.Textures.map((t: string) => blobUrlMap.get(t) || t)
  }

  if (refs.Expressions) {
    for (const expr of refs.Expressions) {
      if (expr.File && blobUrlMap.has(expr.File)) {
        expr.File = blobUrlMap.get(expr.File)
      }
    }
  }

  if (refs.Motions) {
    for (const group of Object.values(refs.Motions)) {
      for (const motion of group as any[]) {
        if (motion.File && blobUrlMap.has(motion.File)) motion.File = blobUrlMap.get(motion.File)
        if (motion.Sound && blobUrlMap.has(motion.Sound)) motion.Sound = blobUrlMap.get(motion.Sound)
      }
    }
  }

  return rewritten
}

/**
 * Load a bundled companion from the extension's public/companions/ folder
 */
export async function loadBundledCompanion(companionId: string = BUNDLED_COMPANION_ID): Promise<LoadedCompanion> {
  const baseUrl = chrome.runtime.getURL(`companions/${companionId}`)

  // Load and validate manifest
  const manifestRes = await fetch(`${baseUrl}/companion.json`)
  if (!manifestRes.ok) {
    throw new Error(`Failed to load companion manifest: ${manifestRes.status}`)
  }
  const manifestJson = await manifestRes.json()
  const manifest = companionManifestSchema.parse(manifestJson)

  // Load and validate personality
  const personalityRes = await fetch(`${baseUrl}/${manifest.personality}`)
  if (!personalityRes.ok) {
    throw new Error(`Failed to load companion personality: ${personalityRes.status}`)
  }
  const personalityJson = await personalityRes.json()
  const personality = companionPersonalitySchema.parse(personalityJson)

  // Try to load animations config
  const animationsResult = await loadCompanionAnimations(baseUrl, companionId)

  return {
    manifest,
    personality,
    modelUrl: `${baseUrl}/${manifest.model.entry}`,
    previewUrl: `${baseUrl}/${manifest.preview}`,
    baseUrl,
    animations: animationsResult?.animations,
    animationsBaseUrl: animationsResult?.animationsBaseUrl,
  }
}

/**
 * Load a VRM companion from IndexedDB (simpler than Live2D)
 * VRM is a single file format - just need to get blob URL for the .vrm file
 */
async function loadVrmCompanion(slug: string, stored: StoredCompanion): Promise<LoadedCompanion | null> {
  const modelEntry = stored.manifest.model.entry
  const createdBlobUrls: string[] = []

  const modelFileUrl = await getCompanionFileUrl(slug, modelEntry)
  if (!modelFileUrl) {
    log.log(`Missing VRM model file for installed companion: ${slug}, entry: ${modelEntry}`)
    return null
  }

  const modelUrl = ensureBlobUrl(modelFileUrl)
  if (modelUrl !== modelFileUrl) {
    createdBlobUrls.push(modelUrl)
  }

  await markCompanionUsed(slug)

  let previewUrl = ''
  const previewFileUrl = await getCompanionFileUrl(slug, stored.manifest.preview)
  if (previewFileUrl) {
    previewUrl = ensureBlobUrl(previewFileUrl)
    if (previewUrl !== previewFileUrl) {
      createdBlobUrls.push(previewUrl)
    }
  }

  trackBlobUrls(slug, createdBlobUrls)
  log.log(`Loaded VRM companion: ${slug} with ${createdBlobUrls.length} blob URLs`)

  return {
    manifest: stored.manifest,
    personality: stored.personality,
    modelUrl,
    previewUrl,
    baseUrl: `indexeddb://${slug}`,
  }
}

/**
 * Load an installed companion from IndexedDB
 * Pre-processes model files to convert data URLs to blob URLs
 * VRM models are simpler (single file), Live2D requires path rewriting
 * Returns null if the companion is not installed or files are missing
 */
export async function loadInstalledCompanion(slug: string): Promise<LoadedCompanion | null> {
  try {
    log.log(`Loading installed companion: ${slug}`)

    const stored = await getCompanionMetadata(slug)
    if (!stored) {
      log.log(`No metadata found for companion: ${slug}`)
      return null
    }

    log.log(`Found metadata for companion: ${slug}, version: ${stored.version}`)

    const modelEntry = stored.manifest.model.entry
    const modelType = detectModelType(modelEntry, stored.manifest.model.type)
    log.log(`Model type: ${modelType}`)

    /** VRM models are simpler - single file, no path rewriting needed */
    if (modelType === 'vrm') {
      return loadVrmCompanion(slug, stored)
    }

    /** Live2D models require path extraction and rewriting */
    const modelBaseDir = getModelBaseDir(modelEntry)

    // Fetch model.json (returns blob URL in extension context, data URL in content script)
    const modelFileUrl = await getCompanionFileUrl(slug, modelEntry)
    if (!modelFileUrl) {
      log.log(`Missing model file for installed companion: ${slug}, entry: ${modelEntry}`)
      return null
    }

    // Parse model.json - need to handle both blob URL and data URL
    let modelJson: any
    if (modelFileUrl.startsWith('blob:') || modelFileUrl.startsWith('http')) {
      // Fetch from blob URL
      const response = await fetch(modelFileUrl)
      modelJson = await response.json()
    } else if (modelFileUrl.startsWith('data:')) {
      // Parse from data URL
      modelJson = JSON.parse(atob(modelFileUrl.split(',')[1]))
    } else {
      log.error(`Unknown URL format for model.json: ${modelFileUrl.substring(0, 30)}`)
      return null
    }

    // Extract all relative file paths from model.json
    const relativeFilePaths = extractModelFilePaths(modelJson)
    log.log(`Found ${relativeFilePaths.length} files to load for model`)

    // Fetch all files and create blob URL map
    // Key = relative path (as in model.json), Value = blob URL
    const blobUrlMap: Map<string, string> = new Map()
    const createdBlobUrls: string[] = []

    for (const relativePath of relativeFilePaths) {
      // Convert relative path to IndexedDB path
      const indexedDBPath = modelBaseDir + relativePath
      const fileUrl = await getCompanionFileUrl(slug, indexedDBPath)
      if (fileUrl) {
        const blobUrl = ensureBlobUrl(fileUrl)
        blobUrlMap.set(relativePath, blobUrl)
        // Track if we created a new blob URL (data URL conversion)
        if (blobUrl !== fileUrl) {
          createdBlobUrls.push(blobUrl)
        }
      } else {
        log.warn(`Missing file: ${indexedDBPath}`)
      }
    }

    // Rewrite model.json with blob URLs
    const rewrittenModelJson = rewriteModelPaths(modelJson, blobUrlMap)

    // DEBUG: Log expression paths after rewriting
    log.log('=== DEBUG: Expression paths after rewriting ===')
    if (rewrittenModelJson.FileReferences?.Expressions) {
      for (const expr of rewrittenModelJson.FileReferences.Expressions) {
        const isBlobUrl = expr.File?.startsWith('blob:')
        log.log(`Expression "${expr.Name}": ${isBlobUrl ? 'BLOB URL' : 'RELATIVE PATH'} - ${expr.File?.substring(0, 60)}`)
      }
    }
    log.log('=== DEBUG: BlobUrlMap contents (first 5) ===')
    let count = 0
    for (const [key, value] of blobUrlMap.entries()) {
      if (count++ >= 5) break
      log.log(`  "${key}" -> ${value.substring(0, 50)}...`)
    }

    // Create blob URL for modified model.json
    const modelBlob = new Blob([JSON.stringify(rewrittenModelJson)], { type: 'application/json' })
    const modelUrl = URL.createObjectURL(modelBlob)
    createdBlobUrls.push(modelUrl)

    // Track blob URLs for cleanup (only the ones we created)
    trackBlobUrls(slug, createdBlobUrls)

    await markCompanionUsed(slug)

    // Get preview image as blob URL
    let previewUrl = ''
    const previewFileUrl = await getCompanionFileUrl(slug, stored.manifest.preview)
    if (previewFileUrl) {
      previewUrl = ensureBlobUrl(previewFileUrl)
      if (previewUrl !== previewFileUrl) {
        trackBlobUrls(slug, [previewUrl])
      }
    }

    log.log(`Loaded installed companion: ${slug} with ${createdBlobUrls.length} blob URLs`)

    return {
      manifest: stored.manifest,
      personality: stored.personality,
      modelUrl,
      previewUrl,
      baseUrl: `indexeddb://${slug}`,
    }
  } catch (error) {
    log.error(`Failed to load installed companion ${slug}:`, error)
    return null
  }
}

/**
 * Get the currently active companion
 * Returns cached companion if same slug to avoid redundant blob URL creation.
 * Always tries IndexedDB first (for Hub-synced plugins), then falls back to bundled.
 * Cleans up blob URLs from previous companion when switching.
 */
export async function getActiveCompanion(activeSlug?: string): Promise<LoadedCompanion> {
  const slug = activeSlug || BUNDLED_COMPANION_ID

  /** Return cached companion if same slug (avoids redundant blob URL creation) */
  if (cachedCompanion && cachedCompanionSlug === slug) {
    return cachedCompanion
  }

  log.log(`Loading companion: ${slug}`)

  /** Clean up blob URLs from previous companion if switching */
  if (currentCompanionSlug && currentCompanionSlug !== slug) {
    log.log(`Switching from ${currentCompanionSlug} to ${slug}, cleaning up blob URLs`)
    revokeCompanionBlobUrls(currentCompanionSlug)
    revokeContentScriptBlobUrls(currentCompanionSlug)
    cachedCompanion = null
    cachedCompanionSlug = null
    /** Small delay to allow browser to release resources before loading new companion */
    await new Promise(resolve => setTimeout(resolve, 50))
  }

  let loadedCompanion: LoadedCompanion

  /** Always try to load from IndexedDB first (even for 'yumi' slug) */
  const installed = await loadInstalledCompanion(slug)
  if (installed) {
    log.log(`Loaded installed companion: ${slug}`)
    loadedCompanion = installed

    /** Sync personality from Hub (with throttling + token refresh) */
    const credentials = await getHubCredentials()
    if (credentials) {
      const syncResult = await syncCompanionFromHub(
        slug,
        credentials.hubUrl,
        credentials.accessToken
      )
      /** If personality was updated, reload from IndexedDB */
      if (syncResult.personalityChanged) {
        const updated = await loadInstalledCompanion(slug)
        if (updated) {
          loadedCompanion = updated
          log.log(`Reloaded companion with updated Hub personality: ${slug}`)
        }
      }
    }
  } else {
    /** Not found in IndexedDB - try loading as bundled companion */
    log.log(`No installed companion found for ${slug}, trying bundled...`)

    try {
      loadedCompanion = await loadBundledCompanion(slug)
      log.log(`Loaded bundled companion: ${slug}`)
    } catch {
      /** Bundled companion doesn't exist - fall back to yumi */
      log.warn(`Bundled companion ${slug} not found, falling back to yumi`)
      loadedCompanion = await loadBundledCompanion(BUNDLED_COMPANION_ID)
    }

    /** Try to get Hub personality for capabilities (plugins, etc.) */
    const credentials = await getHubCredentials()
    if (credentials) {
      const hubPersonality = await fetchHubPersonality(
        slug,
        credentials.hubUrl,
        credentials.accessToken
      )
      if (hubPersonality) {
        log.log(`Using Hub personality for bundled companion`)
        loadedCompanion = {
          ...loadedCompanion,
          personality: hubPersonality,
        }
      }
    }
  }

  /** Track the new companion slug and cache the result */
  currentCompanionSlug = loadedCompanion.manifest.id
  cachedCompanion = loadedCompanion
  cachedCompanionSlug = slug

  return loadedCompanion
}

/**
 * Get companion manifest only (lighter weight for listings)
 */
export async function getCompanionManifest(companionId: string): Promise<CompanionManifest> {
  const baseUrl = chrome.runtime.getURL(`companions/${companionId}`)
  const manifestRes = await fetch(`${baseUrl}/companion.json`)
  if (!manifestRes.ok) {
    throw new Error(`Failed to load companion manifest: ${manifestRes.status}`)
  }
  const manifestJson = await manifestRes.json()
  return companionManifestSchema.parse(manifestJson)
}

/**
 * Check if a bundled companion exists
 */
export async function companionExists(companionId: string): Promise<boolean> {
  try {
    const baseUrl = chrome.runtime.getURL(`companions/${companionId}`)
    const res = await fetch(`${baseUrl}/companion.json`, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Get the default companion ID
 */
export function getDefaultCompanionId(): string {
  return BUNDLED_COMPANION_ID
}

/**
 * Load companion animations configuration from animations/animations.json
 * Returns null if no animations are configured for this companion
 */
export async function loadCompanionAnimations(
  baseUrl: string,
  slug: string
): Promise<{ animations: CompanionAnimations; animationsBaseUrl: string } | null> {
  try {
    const animationsJsonUrl = `${baseUrl}/animations/animations.json`
    const response = await fetch(animationsJsonUrl)

    if (!response.ok) {
      log.log(`No animations.json found for ${slug} (${response.status})`)
      return null
    }

    const animationsJson = await response.json()
    const animations = companionAnimationsSchema.parse(animationsJson)

    log.log(`Loaded animations config for ${slug}: ${animations.animations.length} animations, ${animations.triggers.length} triggers`)

    return {
      animations,
      animationsBaseUrl: `${baseUrl}/animations`,
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Failed to fetch')) {
      log.log(`No animations folder found for ${slug}`)
    } else {
      log.warn(`Failed to load animations for ${slug}:`, error)
    }
    return null
  }
}

/**
 * Sync result indicating what changed
 */
export interface CompanionSyncResult {
  synced: boolean
  personalityChanged: boolean
  newCapabilities?: CompanionPersonality['capabilities']
}

/**
 * Check if enough time has passed since last sync check
 */
function shouldCheckSync(slug: string): boolean {
  const lastCheck = lastSyncCheck.get(slug)
  if (!lastCheck) return true
  return Date.now() - lastCheck > SYNC_CHECK_INTERVAL_MS
}

/**
 * Sync companion personality from Hub
 * Fetches latest personality data and updates IndexedDB if changed
 * Returns sync result indicating if capabilities changed (for plugin reload)
 */
export async function syncCompanionFromHub(
  slug: string,
  hubUrl: string,
  accessToken: string,
  force: boolean = false
): Promise<CompanionSyncResult> {
  /** Check if we should sync (throttle) */
  if (!force && !shouldCheckSync(slug)) {
    log.log(`Skipping sync check for ${slug} - checked recently`)
    return { synced: false, personalityChanged: false }
  }

  /** Update last check timestamp */
  lastSyncCheck.set(slug, Date.now())

  /** Get local companion data */
  const stored = await getCompanionMetadata(slug)
  if (!stored) {
    log.warn(`Cannot sync ${slug} - not installed`)
    return { synced: false, personalityChanged: false }
  }

  try {
    /** Fetch companion info from Hub */
    let response = await fetch(`${hubUrl}/v1/companions/${slug}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    })

    /** If 401, try refreshing token and retry once */
    if (response.status === 401) {
      log.log('Token expired during sync, attempting refresh...')
      const newToken = await refreshAccessToken()
      if (newToken) {
        response = await fetch(`${hubUrl}/v1/companions/${slug}`, {
          headers: {
            'Authorization': `Bearer ${newToken}`,
          },
        })
      }
    }

    if (!response.ok) {
      log.warn(`Sync check failed for ${slug}: ${response.status}`)
      return { synced: false, personalityChanged: false }
    }

    const hubData = await response.json()

    /** Check if personality data has changed using updatedAt or version */
    const hubUpdatedAt = hubData.personality?.updatedAt || hubData.updatedAt
    const localUpdatedAt = (stored as StoredCompanion & { personalityUpdatedAt?: number }).personalityUpdatedAt

    /** If Hub has updatedAt and it matches local, no sync needed */
    if (hubUpdatedAt && localUpdatedAt && new Date(hubUpdatedAt).getTime() === localUpdatedAt) {
      log.log(`Companion ${slug} is up to date`)
      return { synced: false, personalityChanged: false }
    }

    /** Fetch full personality if Hub provides it */
    if (hubData.personality) {
      const hubPersonality = companionPersonalitySchema.parse(hubData.personality)

      /** Check if capabilities changed */
      const oldPlugins = stored.personality.capabilities?.plugins || []
      const newPlugins = hubPersonality.capabilities?.plugins || []
      const pluginsChanged = JSON.stringify(oldPlugins.sort()) !== JSON.stringify(newPlugins.sort())

      /** Update stored companion */
      const updatedCompanion: StoredCompanion & { personalityUpdatedAt?: number } = {
        ...stored,
        personality: hubPersonality,
        personalityUpdatedAt: hubUpdatedAt ? new Date(hubUpdatedAt).getTime() : Date.now(),
      }

      await saveCompanionMetadata(updatedCompanion)
      log.log(`Synced personality for ${slug}`, pluginsChanged ? '(plugins changed)' : '')

      /** Clear cache so next getActiveCompanion() loads fresh data */
      if (cachedCompanionSlug === slug) {
        cachedCompanion = null
        cachedCompanionSlug = null
        log.log(`Cleared cache for updated companion: ${slug}`)
      }

      return {
        synced: true,
        personalityChanged: true,
        newCapabilities: pluginsChanged ? hubPersonality.capabilities : undefined,
      }
    }

    return { synced: false, personalityChanged: false }
  } catch (error) {
    log.error(`Sync failed for ${slug}:`, error)
    return { synced: false, personalityChanged: false }
  }
}

/**
 * Get Hub credentials from storage
 */
async function getHubCredentials(): Promise<{ hubUrl: string; accessToken: string } | null> {
  try {
    const data = await chrome.storage.local.get('settings-store')
    let store
    if (typeof data?.['settings-store'] === 'string') {
      store = JSON.parse(data['settings-store'])
    } else {
      store = data?.['settings-store']
    }

    const hubUrl = store?.state?.hubUrl
    const accessToken = store?.state?.hubAccessToken

    if (!hubUrl || !accessToken) return null
    return { hubUrl, accessToken }
  } catch {
    return null
  }
}

/**
 * Fetch personality from Hub API for a companion
 * Used to get updated capabilities for bundled companions
 */
async function fetchHubPersonality(
  slug: string,
  hubUrl: string,
  accessToken: string
): Promise<CompanionPersonality | null> {
  try {
    const response = await fetch(`${hubUrl}/v1/companions/${slug}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    })
    if (!response.ok) return null
    const data = await response.json()
    if (data.personality) {
      return companionPersonalitySchema.parse(data.personality)
    }
    return null
  } catch (err) {
    log.error(`fetchHubPersonality failed:`, err)
    return null
  }
}

/**
 * Check and sync the active companion
 * Call this periodically or when opening settings
 */
export async function checkAndSyncActiveCompanion(
  activeSlug?: string,
  force: boolean = false
): Promise<CompanionSyncResult> {
  const slug = activeSlug || BUNDLED_COMPANION_ID

  const credentials = await getHubCredentials()
  if (!credentials) {
    log.log('Not logged in, skipping companion sync')
    return { synced: false, personalityChanged: false }
  }

  return syncCompanionFromHub(slug, credentials.hubUrl, credentials.accessToken, force)
}
