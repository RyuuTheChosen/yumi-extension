/**
 * Plugin Ready Hook
 *
 * Provides reactive plugin status tracking for React components.
 * Handles race condition where components mount before plugins load.
 */

import { useState, useEffect } from 'react'
import { isPluginActive } from './loader'
import { bus } from '../core/bus'

/**
 * Hook to track plugin ready state reactively.
 *
 * Handles the race condition where plugins may load after component mounts
 * by both checking synchronously and subscribing to the plugins:loaded event.
 *
 * @param pluginId - The plugin ID to check (e.g., 'tts', 'memory', 'vision')
 * @returns Whether the plugin is currently active
 */
export function usePluginReady(pluginId: string): boolean {
  const [ready, setReady] = useState(() => isPluginActive(pluginId))

  useEffect(() => {
    /** Check immediately - plugins may have loaded between render and effect */
    if (isPluginActive(pluginId)) {
      setReady(true)
    }

    /** Listen for plugin changes (initial load and companion switches) */
    const unsub = bus.on('plugins:loaded', (plugins) => {
      setReady(plugins.includes(pluginId))
    })

    return unsub
  }, [pluginId])

  return ready
}
