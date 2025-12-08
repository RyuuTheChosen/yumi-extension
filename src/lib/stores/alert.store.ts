/**
 * Alert Store
 *
 * Zustand store for managing Solana alerts via WebSocket.
 */

import { create } from 'zustand'
import { createLogger } from '../core/debug'
import type { TokenAlert, AlertSettings, AlertSeverity } from './solana.types'

const log = createLogger('AlertStore')

const DEFAULT_SETTINGS: AlertSettings = {
  enabled: true,
  priceThreshold: 10,
  volumeThreshold: 50,
  severityFilter: ['medium', 'high'],
  soundEnabled: false,
}

interface AlertState {
  alerts: TokenAlert[]
  connected: boolean
  connecting: boolean
  error: string | null
  settings: AlertSettings

  connect: () => void
  disconnect: () => void
  clearAlerts: () => void
  dismissAlert: (id: string) => void
  updateSettings: (settings: Partial<AlertSettings>) => void
}

let ws: WebSocket | null = null
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
const MAX_ALERTS = 50
const RECONNECT_DELAY_MS = 5000

export const useAlertStore = create<AlertState>()((set, get) => ({
  alerts: [],
  connected: false,
  connecting: false,
  error: null,
  settings: DEFAULT_SETTINGS,

  connect: async () => {
    const { connecting, connected, settings } = get()

    if (!settings.enabled || connecting || connected) {
      return
    }

    set({ connecting: true, error: null })

    try {
      const settingsData = await chrome.storage.local.get('settings-store')
      let storedSettings: Record<string, unknown> | undefined

      if (typeof settingsData?.['settings-store'] === 'string') {
        storedSettings = JSON.parse(settingsData['settings-store'])
      } else {
        storedSettings = settingsData?.['settings-store'] as Record<string, unknown> | undefined
      }

      const state = storedSettings?.state as Record<string, unknown> | undefined
      const hubUrl = state?.hubUrl as string | undefined
      const hubAccessToken = state?.hubAccessToken as string | undefined

      if (!hubUrl || !hubAccessToken) {
        set({ connecting: false, error: 'Hub not connected' })
        return
      }

      const wsUrl = hubUrl.replace('https://', 'wss://').replace('http://', 'ws://')
      ws = new WebSocket(`${wsUrl}/v1/solana/alerts/ws?token=${hubAccessToken}`)

      ws.onopen = () => {
        log.log('WebSocket connected')
        set({ connected: true, connecting: false, error: null })
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as {
            type: string
            alert?: TokenAlert
            alerts?: TokenAlert[]
          }

          if (message.type === 'alert' && message.alert) {
            const { alerts, settings: currentSettings } = get()

            if (shouldShowAlert(message.alert, currentSettings)) {
              const newAlerts = [message.alert, ...alerts].slice(0, MAX_ALERTS)
              set({ alerts: newAlerts })
              log.log('New alert:', message.alert.message)
            }
          } else if (message.type === 'recent' && message.alerts) {
            const { settings: currentSettings } = get()
            const filteredAlerts = message.alerts.filter((a) => shouldShowAlert(a, currentSettings))
            set({ alerts: filteredAlerts })
            log.log('Loaded', filteredAlerts.length, 'recent alerts')
          }
        } catch (err) {
          log.error('Failed to parse message:', err)
        }
      }

      ws.onclose = () => {
        log.log('WebSocket disconnected')
        set({ connected: false, connecting: false })
        ws = null

        const { settings: currentSettings } = get()
        if (currentSettings.enabled) {
          scheduleReconnect()
        }
      }

      ws.onerror = (err) => {
        log.error('WebSocket error:', err)
        set({ error: 'Connection error', connecting: false })
      }
    } catch (err) {
      log.error('Failed to connect:', err)
      set({
        connecting: false,
        error: err instanceof Error ? err.message : 'Connection failed',
      })
    }
  },

  disconnect: () => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout)
      reconnectTimeout = null
    }

    if (ws) {
      ws.close()
      ws = null
    }

    set({ connected: false, connecting: false })
    log.log('Disconnected')
  },

  clearAlerts: () => {
    set({ alerts: [] })
    log.log('Alerts cleared')
  },

  dismissAlert: (id: string) => {
    const { alerts } = get()
    set({ alerts: alerts.filter((a) => a.id !== id) })
  },

  updateSettings: (newSettings: Partial<AlertSettings>) => {
    const { settings, connected, disconnect, connect } = get()
    const updatedSettings = { ...settings, ...newSettings }
    set({ settings: updatedSettings })

    if ('enabled' in newSettings) {
      if (newSettings.enabled && !connected) {
        connect()
      } else if (!newSettings.enabled && connected) {
        disconnect()
      }
    }

    chrome.storage.local.set({ 'alert-settings': updatedSettings })
    log.log('Settings updated:', updatedSettings)
  },
}))

function shouldShowAlert(alert: TokenAlert, settings: AlertSettings): boolean {
  if (!settings.severityFilter.includes(alert.severity)) {
    return false
  }

  if (alert.type === 'price_spike' && alert.data.changePercent) {
    if (Math.abs(alert.data.changePercent) < settings.priceThreshold) {
      return false
    }
  }

  if (alert.type === 'volume_spike' && alert.data.changePercent) {
    if (alert.data.changePercent < settings.volumeThreshold) {
      return false
    }
  }

  return true
}

function scheduleReconnect(): void {
  if (reconnectTimeout) return

  log.log('Scheduling reconnect in', RECONNECT_DELAY_MS, 'ms')
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null
    useAlertStore.getState().connect()
  }, RECONNECT_DELAY_MS)
}

async function loadSettings(): Promise<void> {
  try {
    const data = await chrome.storage.local.get('alert-settings')
    if (data['alert-settings']) {
      useAlertStore.setState({ settings: data['alert-settings'] as AlertSettings })
    }
  } catch (err) {
    log.error('Failed to load settings:', err)
  }
}

loadSettings()
