/**
 * External Messaging Handler
 *
 * Handles messages from the Yumi website (yumi.ai) for companion marketplace integration.
 * Uses chrome.runtime.onMessageExternal for secure cross-origin communication.
 */

import {
  getInstalledCompanions,
  isCompanionInstalled,
  installCompanion,
  uninstallCompanion,
} from '../lib/companions'
import { useSettingsStore } from '../lib/stores/settings.store'

// Allowed origins for external messaging
const ALLOWED_ORIGINS = [
  'https://yumi.ai',
  'https://www.yumi.ai',
  'https://hub.yumi.ai',
  'https://yumi-pals.com',
  'https://www.yumi-pals.com',
  'http://localhost',
  'http://127.0.0.1',
]

// Message types from website
type WebsiteMessageType =
  | 'YUMI_PING'
  | 'YUMI_GET_INSTALLED_COMPANIONS'
  | 'YUMI_IS_COMPANION_INSTALLED'
  | 'YUMI_INSTALL_COMPANION'
  | 'YUMI_UNINSTALL_COMPANION'
  | 'YUMI_SET_ACTIVE_COMPANION'
  | 'YUMI_GET_ACTIVE_COMPANION'

interface WebsiteMessage {
  type: WebsiteMessageType
  payload?: unknown
}

interface InstallPayload {
  slug: string
  downloadUrl?: string  // Optional - if not provided, will fetch from Hub API
  checksum?: string     // Optional - if not provided, will fetch from Hub API
}

interface SlugPayload {
  slug: string
}

/**
 * Fetch download URL from Hub API using stored auth token
 */
async function fetchDownloadUrl(slug: string): Promise<{ downloadUrl: string; checksum: string }> {
  const { hubUrl, hubAccessToken } = useSettingsStore.getState()

  if (!hubAccessToken) {
    throw new Error('Please log in to the Yumi extension first. Click the extension icon and enter your invite code.')
  }

  const response = await fetch(`${hubUrl}/v1/companions/${slug}/download`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${hubAccessToken}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Your session has expired. Please click the Yumi extension icon and log in again.')
    }
    if (response.status === 404) {
      throw new Error('This companion is no longer available. It may have been removed from the marketplace.')
    }
    throw new Error(`Download failed (error ${response.status}). Please try again later.`)
  }

  const data = await response.json()
  return {
    downloadUrl: data.downloadUrl,
    checksum: data.checksumSha256,
  }
}

// Response types to website
type ExtensionResponse =
  | { type: 'YUMI_PONG'; version: string }
  | { type: 'YUMI_INSTALLED_COMPANIONS'; companions: string[] }
  | { type: 'YUMI_IS_INSTALLED'; installed: boolean }
  | { type: 'YUMI_INSTALL_SUCCESS'; slug: string }
  | { type: 'YUMI_INSTALL_ERROR'; error: string }
  | { type: 'YUMI_UNINSTALL_SUCCESS'; slug: string }
  | { type: 'YUMI_UNINSTALL_ERROR'; error: string }
  | { type: 'YUMI_ACTIVE_COMPANION'; slug: string | null }
  | { type: 'YUMI_SET_ACTIVE_SUCCESS'; slug: string }
  | { type: 'YUMI_ERROR'; error: string }

/**
 * Check if an origin is allowed
 */
function isAllowedOrigin(origin: string): boolean {
  return ALLOWED_ORIGINS.some(allowed => {
    if (allowed.startsWith('http://localhost') || allowed.startsWith('http://127.0.0.1')) {
      return origin.startsWith(allowed)
    }
    return origin === allowed || origin.endsWith(allowed.replace('https://', '.'))
  })
}

/**
 * Get extension version from manifest
 */
function getExtensionVersion(): string {
  return chrome.runtime.getManifest().version
}

/**
 * Handle messages from the website
 */
async function handleExternalMessage(
  message: WebsiteMessage,
  sender: chrome.runtime.MessageSender
): Promise<ExtensionResponse> {
  const origin = sender.origin || sender.url || ''

  // Validate origin
  if (!isAllowedOrigin(origin)) {
    console.warn(`[ExternalMessaging] Rejected message from unauthorized origin: ${origin}`)
    return { type: 'YUMI_ERROR', error: 'Unauthorized origin' }
  }

  console.log(`[ExternalMessaging] Received ${message.type} from ${origin}`)

  try {
    switch (message.type) {
      case 'YUMI_PING':
        return {
          type: 'YUMI_PONG',
          version: getExtensionVersion(),
        }

      case 'YUMI_GET_INSTALLED_COMPANIONS': {
        const companions = await getInstalledCompanions()
        return {
          type: 'YUMI_INSTALLED_COMPANIONS',
          companions: companions.map(c => c.slug),
        }
      }

      case 'YUMI_IS_COMPANION_INSTALLED': {
        const { slug } = message.payload as SlugPayload
        const installed = await isCompanionInstalled(slug)
        return {
          type: 'YUMI_IS_INSTALLED',
          installed,
        }
      }

      case 'YUMI_INSTALL_COMPANION': {
        const payload = message.payload as InstallPayload

        if (!payload?.slug) {
          return {
            type: 'YUMI_INSTALL_ERROR',
            error: 'Missing required field: slug',
          }
        }

        try {
          let downloadUrl = payload.downloadUrl
          let checksum = payload.checksum

          // If download URL not provided, fetch from Hub API
          if (!downloadUrl || !checksum) {
            console.log(`[ExternalMessaging] Fetching download URL for ${payload.slug}`)
            const downloadInfo = await fetchDownloadUrl(payload.slug)
            downloadUrl = downloadInfo.downloadUrl
            checksum = downloadInfo.checksum
          }

          await installCompanion(payload.slug, downloadUrl, checksum)
          return {
            type: 'YUMI_INSTALL_SUCCESS',
            slug: payload.slug,
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          return {
            type: 'YUMI_INSTALL_ERROR',
            error: errorMessage,
          }
        }
      }

      case 'YUMI_UNINSTALL_COMPANION': {
        const { slug } = message.payload as SlugPayload

        if (!slug) {
          return {
            type: 'YUMI_UNINSTALL_ERROR',
            error: 'Missing required field: slug',
          }
        }

        try {
          await uninstallCompanion(slug)

          // If uninstalled companion was the active one, reset to bundled default
          const { activeCompanionSlug, setActiveCompanionSlug } = useSettingsStore.getState()
          if (activeCompanionSlug === slug) {
            console.log(`[ExternalMessaging] Resetting active companion from ${slug} to yumi (bundled)`)
            setActiveCompanionSlug('yumi')

            // Notify all tabs to remount with the new companion
            // This ensures immediate update even if storage change is debounced
            notifyCompanionChanged('yumi')
          }

          return {
            type: 'YUMI_UNINSTALL_SUCCESS',
            slug,
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error'
          return {
            type: 'YUMI_UNINSTALL_ERROR',
            error: errorMsg,
          }
        }
      }

      case 'YUMI_GET_ACTIVE_COMPANION': {
        // Get active companion from storage
        const result = await chrome.storage.local.get('activeCompanionSlug')
        return {
          type: 'YUMI_ACTIVE_COMPANION',
          slug: result.activeCompanionSlug || 'yumi',
        }
      }

      case 'YUMI_SET_ACTIVE_COMPANION': {
        const { slug } = message.payload as SlugPayload

        if (!slug) {
          return {
            type: 'YUMI_ERROR',
            error: 'Missing required field: slug',
          }
        }

        // Save active companion to storage
        await chrome.storage.local.set({ activeCompanionSlug: slug })
        return {
          type: 'YUMI_SET_ACTIVE_SUCCESS',
          slug,
        }
      }

      default:
        return {
          type: 'YUMI_ERROR',
          error: `Unknown message type: ${message.type}`,
        }
    }
  } catch (error) {
    console.error('[ExternalMessaging] Error handling message:', error)
    return {
      type: 'YUMI_ERROR',
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Setup external messaging listener
 * Call this from the background service worker
 */
export function setupExternalMessaging(): void {
  chrome.runtime.onMessageExternal.addListener(
    (message: WebsiteMessage, sender, sendResponse) => {
      // Handle async response
      handleExternalMessage(message, sender)
        .then(sendResponse)
        .catch(error => {
          console.error('[ExternalMessaging] Unhandled error:', error)
          sendResponse({
            type: 'YUMI_ERROR',
            error: 'Internal error',
          })
        })

      // Return true to indicate async response
      return true
    }
  )

  console.log('[ExternalMessaging] External messaging listener registered')
}

/**
 * Notify all tabs that the active companion has changed
 * This triggers an immediate remount without waiting for storage change detection
 */
async function notifyCompanionChanged(newSlug: string): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({})
    for (const tab of tabs) {
      if (tab.id) {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: 'COMPANION_CHANGED',
            payload: { slug: newSlug },
          })
        } catch {
          // Tab might not have content script, ignore
        }
      }
    }
    console.log(`[ExternalMessaging] Notified ${tabs.length} tabs of companion change to ${newSlug}`)
  } catch (error) {
    console.error('[ExternalMessaging] Failed to notify tabs:', error)
  }
}
