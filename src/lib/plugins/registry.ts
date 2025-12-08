import type { Plugin, RegisteredPlugin, PluginState } from './types'
import { createLogger } from '../core/debug'

const log = createLogger('PluginRegistry')

/**
 * Plugin Registry
 *
 * Central registry for all available plugins.
 * Plugins register themselves here, and the loader
 * fetches them based on companion capabilities.
 */

// Map of plugin ID -> registered plugin
const plugins = new Map<string, RegisteredPlugin>()

// Runtime state of plugins
const pluginStates = new Map<string, PluginState>()

/**
 * Register a plugin
 */
export function registerPlugin(plugin: Plugin): void {
  const { id } = plugin.manifest

  if (plugins.has(id)) {
    log.warn(`Plugin "${id}" already registered, replacing`)
  }

  plugins.set(id, { plugin })
  pluginStates.set(id, {
    id,
    enabled: false,
    initialized: false,
  })

  log.log(`Registered plugin: ${id}`)
}

/**
 * Register a plugin factory (lazy instantiation)
 */
export function registerPluginFactory(id: string, factory: () => Plugin): void {
  if (plugins.has(id)) {
    log.warn(`Plugin "${id}" already registered, replacing`)
  }

  plugins.set(id, { plugin: null as unknown as Plugin, factory })
  pluginStates.set(id, {
    id,
    enabled: false,
    initialized: false,
  })

  log.log(`Registered plugin factory: ${id}`)
}

/**
 * Get a plugin by ID
 */
export function getPlugin(id: string): Plugin | null {
  const entry = plugins.get(id)
  if (!entry) return null

  // If factory exists and plugin not instantiated, create it
  if (entry.factory && !entry.plugin) {
    entry.plugin = entry.factory()
  }

  return entry.plugin
}

/**
 * Get all registered plugin IDs
 */
export function getRegisteredPluginIds(): string[] {
  return Array.from(plugins.keys())
}

/**
 * Check if a plugin is registered
 */
export function isPluginRegistered(id: string): boolean {
  return plugins.has(id)
}

/**
 * Get plugin state
 */
export function getPluginState(id: string): PluginState | null {
  return pluginStates.get(id) ?? null
}

/**
 * Update plugin state
 */
export function updatePluginState(id: string, updates: Partial<PluginState>): void {
  const state = pluginStates.get(id)
  if (state) {
    pluginStates.set(id, { ...state, ...updates })
  }
}

/**
 * Get all plugin states
 */
export function getAllPluginStates(): Map<string, PluginState> {
  return new Map(pluginStates)
}

/**
 * Clear all plugins (for testing)
 */
export function clearRegistry(): void {
  plugins.clear()
  pluginStates.clear()
}
