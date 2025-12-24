/**
 * Hub Authentication Module
 *
 * Handles JWT token refresh and storage for Yumi Hub API.
 * Implements automatic token renewal when access tokens expire.
 *
 * SECURITY NOTES:
 * - Access tokens are stored in chrome.storage.session (cleared on browser close)
 * - Refresh tokens are encrypted with AES-GCM before storage in chrome.storage.local
 * - Token values are never logged to prevent credential leakage
 */

import { createLogger } from '../lib/core/debug'
import { encryptApiKey, decryptApiKey, type EncryptedBlob } from '../lib/crypto/crypto'
import type { HubUser, SettingsStateWithAuth } from '../types'

const log = createLogger('Auth')

/** Storage keys for secure token storage */
const ACCESS_TOKEN_KEY = 'hubAccessToken'
const REFRESH_TOKEN_KEY = 'hubRefreshTokenEncrypted'

/** Redact token for safe logging */
function redactToken(token: string | null | undefined): string {
  if (!token) return '[none]'
  if (token.length < 10) return '[redacted]'
  return `${token.substring(0, 4)}...${token.substring(token.length - 4)}`
}

/**
 * Get access token from session storage
 * Session storage is cleared when browser closes (MV3 security best practice)
 */
export async function getAccessToken(): Promise<string | null> {
  try {
    const data = await chrome.storage.session.get(ACCESS_TOKEN_KEY)
    return data[ACCESS_TOKEN_KEY] || null
  } catch (err) {
    log.error('[Auth] Failed to get access token:', err)
    return null
  }
}

/**
 * Store access token in session storage
 */
export async function setAccessToken(token: string | null): Promise<void> {
  try {
    if (token) {
      await chrome.storage.session.set({ [ACCESS_TOKEN_KEY]: token })
    } else {
      await chrome.storage.session.remove(ACCESS_TOKEN_KEY)
    }
  } catch (err) {
    log.error('[Auth] Failed to set access token:', err)
  }
}

/**
 * Get encrypted refresh token from local storage and decrypt it
 */
export async function getRefreshToken(): Promise<string | null> {
  try {
    const data = await chrome.storage.local.get(REFRESH_TOKEN_KEY)
    const encrypted = data[REFRESH_TOKEN_KEY] as EncryptedBlob | null
    if (!encrypted) return null
    return await decryptApiKey(encrypted)
  } catch (err) {
    log.error('[Auth] Failed to get refresh token:', err)
    return null
  }
}

/**
 * Encrypt and store refresh token in local storage
 */
export async function setRefreshToken(token: string | null): Promise<void> {
  try {
    if (token) {
      const encrypted = await encryptApiKey(token)
      await chrome.storage.local.set({ [REFRESH_TOKEN_KEY]: encrypted })
    } else {
      await chrome.storage.local.remove(REFRESH_TOKEN_KEY)
    }
  } catch (err) {
    log.error('[Auth] Failed to set refresh token:', err)
  }
}

/**
 * Migrate legacy tokens from settings-store to secure storage
 * Called once on extension startup to handle upgrade from v21 to v22
 */
export async function migrateTokensToSecureStorage(): Promise<void> {
  try {
    const data = await chrome.storage.local.get('settings-store')
    if (!data?.['settings-store']) return

    let settingsStore: { state?: Record<string, unknown>; version?: number }
    if (typeof data['settings-store'] === 'string') {
      try {
        settingsStore = JSON.parse(data['settings-store'])
      } catch {
        return
      }
    } else {
      settingsStore = data['settings-store']
    }

    const state = settingsStore?.state
    if (!state) return

    const legacyAccessToken = state.hubAccessToken as string | undefined
    const legacyRefreshToken = state.hubRefreshToken as string | undefined

    /** If no legacy tokens, nothing to migrate */
    if (!legacyAccessToken && !legacyRefreshToken) {
      log.log('[Auth] No legacy tokens to migrate')
      return
    }

    log.log('[Auth] Migrating legacy tokens to secure storage...')

    /** Migrate access token to session storage */
    if (legacyAccessToken) {
      await setAccessToken(legacyAccessToken)
      log.log('[Auth] Access token migrated to session storage')
    }

    /** Encrypt and migrate refresh token */
    if (legacyRefreshToken) {
      await setRefreshToken(legacyRefreshToken)
      log.log('[Auth] Refresh token encrypted and migrated')
    }

    /** Remove legacy tokens from settings store */
    delete state.hubAccessToken
    delete state.hubRefreshToken
    await chrome.storage.local.set({ 'settings-store': JSON.stringify(settingsStore) })
    log.log('[Auth] Legacy tokens removed from settings store')
  } catch (err) {
    log.error('[Auth] Token migration failed:', err)
  }
}

/**
 * Persisted store structure (Zustand persist middleware wraps in 'state')
 */
interface PersistedStore<T> {
  state: T
  version: number
}

/**
 * Hub configuration for token refresh
 */
export interface HubConfig {
  hubUrl: string
  /** @deprecated Tokens now stored securely, not passed in config */
  hubAccessToken?: string
  /** @deprecated Tokens now stored securely, not passed in config */
  hubRefreshToken?: string | null
  /** @deprecated User data obtained from refresh response */
  settingsStore?: PersistedStore<SettingsStateWithAuth>
}

/**
 * Try to refresh Hub access token using refresh token
 *
 * @param hubConfig - Hub configuration with current tokens
 * @returns True if refresh succeeded, false otherwise
 */
export async function tryRefreshHubToken(hubConfig: HubConfig): Promise<boolean> {
  const { hubUrl } = hubConfig

  /** Get refresh token from secure encrypted storage */
  const refreshToken = await getRefreshToken()
  if (!refreshToken) {
    log.log('[Auth] No refresh token available')
    return false
  }

  try {
    const res = await fetch(`${hubUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    })

    if (!res.ok) {
      log.error('[Auth] Hub refresh failed:', res.status)
      /** Clear auth on failure */
      await updateHubAuth(null, null, null)
      return false
    }

    const data = await res.json()
    /** Update stored tokens using secure storage */
    await updateHubAuth(
      data.accessToken,
      data.refreshToken,
      data.user || hubConfig.settingsStore?.state?.hubUser || null
    )
    log.log(`[Auth] Hub token refreshed successfully (new token: ${redactToken(data.accessToken)})`)
    return true
  } catch (err) {
    log.error('[Auth] Hub refresh error:', err)
    return false
  }
}

/**
 * Update Hub authentication tokens in Chrome storage
 *
 * SECURITY: Access token goes to session storage (cleared on browser close)
 * SECURITY: Refresh token is encrypted with AES-GCM before local storage
 *
 * @param accessToken - New access token or null to clear
 * @param refreshToken - New refresh token or null to clear
 * @param user - User data or null to clear
 */
export async function updateHubAuth(
  accessToken: string | null,
  refreshToken: string | null,
  user: HubUser | null
): Promise<void> {
  try {
    /** Store access token in session storage (cleared on browser close) */
    await setAccessToken(accessToken)

    /** Encrypt and store refresh token in local storage */
    await setRefreshToken(refreshToken)

    /** Update user info in settings store (non-sensitive) */
    const data = await chrome.storage.local.get('settings-store')
    let settingsStore: PersistedStore<SettingsStateWithAuth>

    if (typeof data?.['settings-store'] === 'string') {
      try {
        settingsStore = JSON.parse(data['settings-store'])
      } catch {
        log.warn('[Auth] Failed to parse settings-store, using defaults')
        settingsStore = { state: {} as SettingsStateWithAuth, version: 0 }
      }
    } else {
      settingsStore = data?.['settings-store'] || { state: {} as SettingsStateWithAuth, version: 0 }
    }

    /** Only store user info in settings (tokens are stored separately for security) */
    settingsStore.state = {
      ...settingsStore.state,
      hubUser: user || undefined
    }

    /** Remove legacy token fields if present (migrated to secure storage) */
    delete (settingsStore.state as unknown as Record<string, unknown>).hubAccessToken
    delete (settingsStore.state as unknown as Record<string, unknown>).hubRefreshToken

    await chrome.storage.local.set({ 'settings-store': JSON.stringify(settingsStore) })
    log.log(`[Auth] Hub auth updated (token: ${redactToken(accessToken)})`)
  } catch (err) {
    log.error('[Auth] Failed to update Hub auth:', err)
    throw err
  }
}
