/**
 * Hub Authentication Module
 *
 * Handles JWT token refresh and storage for Yumi Hub API.
 * Implements automatic token renewal when access tokens expire.
 */

import { createLogger } from '../lib/debug'
import type { HubUser, SettingsStateWithAuth } from '../types'

const log = createLogger('Auth')

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
  hubAccessToken: string
  hubRefreshToken: string | null
  settingsStore: PersistedStore<SettingsStateWithAuth>
}

/**
 * Try to refresh Hub access token using refresh token
 *
 * @param hubConfig - Hub configuration with current tokens
 * @returns True if refresh succeeded, false otherwise
 */
export async function tryRefreshHubToken(hubConfig: HubConfig): Promise<boolean> {
  const { hubUrl, hubRefreshToken } = hubConfig
  if (!hubRefreshToken) return false

  try {
    const res = await fetch(`${hubUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: hubRefreshToken })
    })

    if (!res.ok) {
      log.error('[Auth] Hub refresh failed:', res.status)
      // Clear auth on failure
      await updateHubAuth(null, null, null)
      return false
    }

    const data = await res.json()
    // Update stored tokens
    await updateHubAuth(
      data.accessToken,
      data.refreshToken,
      data.user || hubConfig.settingsStore?.state?.hubUser || null
    )
    log.log('[Auth] Hub token refreshed successfully')
    return true
  } catch (err) {
    log.error('[Auth] Hub refresh error:', err)
    return false
  }
}

/**
 * Update Hub authentication tokens in Chrome storage
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
  const data = await chrome.storage.local.get('settings-store')
  let settingsStore: PersistedStore<SettingsStateWithAuth>

  if (typeof data?.['settings-store'] === 'string') {
    settingsStore = JSON.parse(data['settings-store'])
  } else {
    settingsStore = data?.['settings-store'] || { state: {}, version: 0 }
  }

  settingsStore.state = {
    ...settingsStore.state,
    hubAccessToken: accessToken || undefined,
    hubRefreshToken: refreshToken || undefined,
    hubUser: user || undefined
  }

  await chrome.storage.local.set({ 'settings-store': JSON.stringify(settingsStore) })
  log.log('[Auth] Hub auth updated in storage')
}
