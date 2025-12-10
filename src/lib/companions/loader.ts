import {
  companionManifestSchema,
  companionPersonalitySchema,
  type CompanionManifest,
  type CompanionPersonality,
  type LoadedCompanion,
} from './types'
import {
  getCompanionMetadata,
  getCompanionFileUrl,
  markCompanionUsed,
  revokeCompanionBlobUrls,
  saveCompanionMetadata,
  type StoredCompanion,
} from './db'
import { createLogger } from '../core/debug'
import { refreshAccessToken } from '../tts/ttsService'

const log = createLogger('CompanionLoader')

/** Sync check interval in milliseconds (5 minutes) */
const SYNC_CHECK_INTERVAL_MS = 5 * 60 * 1000

/** Track last sync check timestamp per companion */
const lastSyncCheck: Map<string, number> = new Map()

// Default bundled companion ID
const BUNDLED_COMPANION_ID = 'yumi'

// Track the currently loaded companion slug for cleanup
let currentCompanionSlug: string | null = null

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

  return {
    manifest,
    personality,
    modelUrl: `${baseUrl}/${manifest.model.entry}`,
    previewUrl: `${baseUrl}/${manifest.preview}`,
    baseUrl,
  }
}

/**
 * Load an installed companion from IndexedDB
 * Returns null if the companion is not installed or files are missing
 */
export async function loadInstalledCompanion(slug: string): Promise<LoadedCompanion | null> {
  try {
    const stored = await getCompanionMetadata(slug)
    if (!stored) return null

    // Get URLs for model files - these are blob URLs created from IndexedDB
    const modelEntry = stored.manifest.model.entry
    const modelUrl = await getCompanionFileUrl(slug, modelEntry)
    const previewUrl = await getCompanionFileUrl(slug, stored.manifest.preview)

    if (!modelUrl) {
      log.warn(`Missing model file for installed companion: ${slug}`)
      return null
    }

    // Mark as used
    await markCompanionUsed(slug)

    return {
      manifest: stored.manifest,
      personality: stored.personality,
      modelUrl,
      previewUrl: previewUrl || '',
      baseUrl: `indexeddb://${slug}`, // Special marker for installed companions
    }
  } catch (error) {
    log.error(`Failed to load installed companion ${slug}:`, error)
    return null
  }
}

/**
 * Get the currently active companion
 * Checks IndexedDB for installed companion first, then falls back to bundled
 * Cleans up blob URLs from previous companion when switching
 */
export async function getActiveCompanion(activeSlug?: string): Promise<LoadedCompanion> {
  const slug = activeSlug || BUNDLED_COMPANION_ID

  // Clean up blob URLs from previous companion if switching
  if (currentCompanionSlug && currentCompanionSlug !== slug) {
    log.log(`Switching from ${currentCompanionSlug} to ${slug}, cleaning up blob URLs`)
    revokeCompanionBlobUrls(currentCompanionSlug)
  }

  let loadedCompanion: LoadedCompanion

  // First, try to load from IndexedDB if it's not the bundled companion
  if (slug !== BUNDLED_COMPANION_ID) {
    const installed = await loadInstalledCompanion(slug)
    if (installed) {
      log.log(`Loaded installed companion: ${slug}`)
      loadedCompanion = installed
    } else {
      log.warn(`Installed companion ${slug} not found, falling back to bundled`)
      loadedCompanion = await loadBundledCompanion(BUNDLED_COMPANION_ID)
    }
  } else {
    // Fall back to bundled companion
    loadedCompanion = await loadBundledCompanion(BUNDLED_COMPANION_ID)
  }

  // Track the new companion slug
  currentCompanionSlug = loadedCompanion.manifest.id

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
  /** Skip bundled companions - they don't sync from Hub */
  if (slug === BUNDLED_COMPANION_ID) {
    return { synced: false, personalityChanged: false }
  }

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
 * Check and sync the active companion
 * Call this periodically or when opening settings
 */
export async function checkAndSyncActiveCompanion(
  activeSlug?: string,
  force: boolean = false
): Promise<CompanionSyncResult> {
  const slug = activeSlug || BUNDLED_COMPANION_ID
  if (slug === BUNDLED_COMPANION_ID) {
    return { synced: false, personalityChanged: false }
  }

  const credentials = await getHubCredentials()
  if (!credentials) {
    log.log('Not logged in, skipping companion sync')
    return { synced: false, personalityChanged: false }
  }

  return syncCompanionFromHub(slug, credentials.hubUrl, credentials.accessToken, force)
}
