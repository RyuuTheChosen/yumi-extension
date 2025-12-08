import type { Plugin, PluginState, CompanionCapabilities } from './types'
import {
  getPlugin,
  getPluginState,
  updatePluginState,
  getRegisteredPluginIds,
  isPluginRegistered,
} from './registry'
import { createLogger } from '../core/debug'

const log = createLogger('PluginLoader')

/**
 * Plugin Loader
 *
 * Loads and initializes plugins based on companion capabilities.
 * Handles plugin lifecycle (init, cleanup) when companion changes.
 */

// Currently active plugins
let activePlugins: Plugin[] = []
let activePluginIds: Set<string> = new Set()

/**
 * Load plugins for a companion based on capabilities
 */
export async function loadPluginsForCompanion(
  capabilities: CompanionCapabilities | undefined
): Promise<Plugin[]> {
  const requestedPlugins = capabilities?.plugins ?? []

  log.log('Loading plugins for companion:', requestedPlugins)

  // Cleanup previously active plugins that are no longer needed
  const toDisable = Array.from(activePluginIds).filter(
    id => !requestedPlugins.includes(id)
  )

  for (const id of toDisable) {
    await disablePlugin(id)
  }

  // Enable requested plugins
  const enabledPlugins: Plugin[] = []

  for (const id of requestedPlugins) {
    if (!isPluginRegistered(id)) {
      log.warn(`Plugin "${id}" requested but not registered`)
      continue
    }

    const plugin = await enablePlugin(id)
    if (plugin) {
      enabledPlugins.push(plugin)
    }
  }

  activePlugins = enabledPlugins
  activePluginIds = new Set(enabledPlugins.map(p => p.manifest.id))

  log.log('Active plugins:', Array.from(activePluginIds))

  return enabledPlugins
}

/**
 * Enable and initialize a plugin
 */
async function enablePlugin(id: string): Promise<Plugin | null> {
  const plugin = getPlugin(id)
  if (!plugin) {
    log.error(`Plugin "${id}" not found in registry`)
    return null
  }

  const state = getPluginState(id)
  if (state?.enabled && state?.initialized) {
    // Already enabled and initialized
    return plugin
  }

  try {
    // Initialize if needed
    if (plugin.initialize && !state?.initialized) {
      log.log(`Initializing plugin: ${id}`)
      await plugin.initialize()
    }

    updatePluginState(id, {
      enabled: true,
      initialized: true,
      error: undefined,
    })

    return plugin
  } catch (error) {
    log.error(`Failed to initialize plugin "${id}":`, error)
    updatePluginState(id, {
      enabled: false,
      initialized: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return null
  }
}

/**
 * Disable and cleanup a plugin
 */
async function disablePlugin(id: string): Promise<void> {
  const plugin = getPlugin(id)
  if (!plugin) return

  const state = getPluginState(id)
  if (!state?.enabled) return

  try {
    if (plugin.cleanup) {
      log.log(`Cleaning up plugin: ${id}`)
      plugin.cleanup()
    }

    updatePluginState(id, {
      enabled: false,
    })
  } catch (error) {
    log.error(`Failed to cleanup plugin "${id}":`, error)
  }
}

/**
 * Get currently active plugins
 */
export function getActivePlugins(): Plugin[] {
  return activePlugins
}

/**
 * Get active plugin IDs
 */
export function getActivePluginIds(): string[] {
  return Array.from(activePluginIds)
}

/**
 * Check if a plugin is currently active
 */
export function isPluginActive(id: string): boolean {
  return activePluginIds.has(id)
}

/**
 * Get an active plugin by ID
 */
export function getActivePlugin(id: string): Plugin | null {
  if (!isPluginActive(id)) return null
  return getPlugin(id)
}

/**
 * Get all active plugin states
 */
export function getActivePluginStates(): PluginState[] {
  return Array.from(activePluginIds)
    .map(id => getPluginState(id))
    .filter((s): s is PluginState => s !== null)
}

/**
 * Cleanup all active plugins
 */
export async function cleanupAllPlugins(): Promise<void> {
  log.log('Cleaning up all plugins')

  for (const id of activePluginIds) {
    await disablePlugin(id)
  }

  activePlugins = []
  activePluginIds.clear()
}

/**
 * Build combined prompt additions from all active plugins
 */
export function buildPluginPromptAdditions(context: {
  companionName: string
  pageUrl?: string
  pageTitle?: string
  hasMemories: boolean
}): string {
  const additions: string[] = []

  for (const plugin of activePlugins) {
    if (plugin.getPromptAdditions) {
      const addition = plugin.getPromptAdditions(context)
      if (addition) {
        additions.push(addition)
      }
    }
  }

  return additions.join('\n\n')
}

/**
 * Check all active plugins for trigger matches
 */
export function checkPluginTriggers(message: string) {
  for (const plugin of activePlugins) {
    if (plugin.analyzeTrigger) {
      const result = plugin.analyzeTrigger(message)
      if (result && result.confidence > 0.5) {
        return result
      }
    }
  }
  return null
}
