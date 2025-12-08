import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { Plugin, PluginState, CompanionCapabilities } from './types'
import {
  loadPluginsForCompanion,
  getActivePlugins,
  getActivePluginIds,
  isPluginActive,
  getActivePlugin,
  cleanupAllPlugins,
} from './loader'
import { bus } from '../core/bus'
import { createLogger } from '../core/debug'

const log = createLogger('PluginContext')

/**
 * Plugin Context
 *
 * Provides React components access to the plugin system.
 * Handles automatic plugin loading when companion changes.
 */

interface PluginContextValue {
  // Active plugins
  plugins: Plugin[]
  pluginIds: string[]

  // Check if a specific plugin is active
  hasPlugin: (id: string) => boolean

  // Get a specific plugin
  getPlugin: (id: string) => Plugin | null

  // Loading state
  isLoading: boolean

  // Reload plugins (e.g., after companion change)
  reloadPlugins: (capabilities: CompanionCapabilities | undefined) => Promise<void>
}

const PluginContext = createContext<PluginContextValue | null>(null)

interface PluginProviderProps {
  children: ReactNode
  initialCapabilities?: CompanionCapabilities
}

export function PluginProvider({ children, initialCapabilities }: PluginProviderProps) {
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [pluginIds, setPluginIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const reloadPlugins = useCallback(async (capabilities: CompanionCapabilities | undefined) => {
    setIsLoading(true)
    try {
      log.log('Reloading plugins with capabilities:', capabilities)
      const loadedPlugins = await loadPluginsForCompanion(capabilities)
      setPlugins(loadedPlugins)
      setPluginIds(loadedPlugins.map(p => p.manifest.id))
    } catch (error) {
      log.error('Failed to reload plugins:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const hasPlugin = useCallback((id: string) => {
    return isPluginActive(id)
  }, [pluginIds]) // Re-check when pluginIds changes

  const getPluginById = useCallback((id: string) => {
    return getActivePlugin(id)
  }, [pluginIds])

  // Load initial plugins
  useEffect(() => {
    if (initialCapabilities) {
      reloadPlugins(initialCapabilities)
    }
  }, []) // Only on mount

  // Listen for companion changes
  useEffect(() => {
    const unsubscribe = bus.on('companion:changed', (companion) => {
      log.log('Companion changed, reloading plugins')
      const capabilities = (companion as any)?.personality?.capabilities as CompanionCapabilities | undefined
      reloadPlugins(capabilities)
    })

    return () => {
      unsubscribe()
    }
  }, [reloadPlugins])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupAllPlugins()
    }
  }, [])

  const value: PluginContextValue = {
    plugins,
    pluginIds,
    hasPlugin,
    getPlugin: getPluginById,
    isLoading,
    reloadPlugins,
  }

  return (
    <PluginContext.Provider value={value}>
      {children}
    </PluginContext.Provider>
  )
}

/**
 * Hook to access plugin context
 */
export function usePlugins(): PluginContextValue {
  const context = useContext(PluginContext)
  if (!context) {
    throw new Error('usePlugins must be used within a PluginProvider')
  }
  return context
}

/**
 * Hook to check if a specific plugin is available
 */
export function useHasPlugin(pluginId: string): boolean {
  const { hasPlugin } = usePlugins()
  return hasPlugin(pluginId)
}

/**
 * Hook to get a specific plugin
 */
export function usePlugin<T extends Plugin = Plugin>(pluginId: string): T | null {
  const { getPlugin, pluginIds } = usePlugins()
  // Re-evaluate when pluginIds changes
  return getPlugin(pluginId) as T | null
}
