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
  type StoredCompanion,
} from './db'

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
      console.warn(`[Loader] Missing model file for installed companion: ${slug}`)
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
    console.error(`[Loader] Failed to load installed companion ${slug}:`, error)
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
    console.log(`[Loader] Switching from ${currentCompanionSlug} to ${slug}, cleaning up blob URLs`)
    revokeCompanionBlobUrls(currentCompanionSlug)
  }

  let loadedCompanion: LoadedCompanion

  // First, try to load from IndexedDB if it's not the bundled companion
  if (slug !== BUNDLED_COMPANION_ID) {
    const installed = await loadInstalledCompanion(slug)
    if (installed) {
      console.log(`[Loader] Loaded installed companion: ${slug}`)
      loadedCompanion = installed
    } else {
      console.warn(`[Loader] Installed companion ${slug} not found, falling back to bundled`)
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
