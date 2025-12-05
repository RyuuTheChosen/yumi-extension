import type { LoadedCompanion, CompanionPersonality } from './types'
import { getActiveCompanion as loadActiveCompanion, getDefaultCompanionId } from './loader'
import { loadPluginsForCompanion, getActivePlugins, type Plugin } from '../plugins'
import { bus } from '../bus'
import { createLogger } from '../debug'

const log = createLogger('CompanionManager')

/**
 * CompanionManager
 *
 * Central manager for companion state. Handles:
 * - Loading and caching the active companion
 * - Emitting events when companion changes
 * - Loading plugins based on companion capabilities
 * - Providing personality for prompt building
 */

class CompanionManager {
  private cache: LoadedCompanion | null = null
  private currentSlug: string | null = null
  private plugins: Plugin[] = []
  private initialized = false

  /**
   * Initialize the manager with the current active companion
   */
  async initialize(activeSlug?: string): Promise<LoadedCompanion> {
    const slug = activeSlug || await this.getStoredActiveSlug() || getDefaultCompanionId()
    log.log('Initializing with companion:', slug)

    const companion = await this.loadCompanion(slug)
    this.initialized = true

    return companion
  }

  /**
   * Get the active companion (loads if not cached)
   */
  async getActiveCompanion(): Promise<LoadedCompanion> {
    if (this.cache) {
      return this.cache
    }

    const slug = await this.getStoredActiveSlug() || getDefaultCompanionId()
    return this.loadCompanion(slug)
  }

  /**
   * Get the active companion's personality
   */
  async getActivePersonality(): Promise<CompanionPersonality> {
    const companion = await this.getActiveCompanion()
    return companion.personality
  }

  /**
   * Get enabled plugins for the active companion
   */
  getEnabledPlugins(): Plugin[] {
    return this.plugins
  }

  /**
   * Get enabled plugin IDs
   */
  getEnabledPluginIds(): string[] {
    return this.plugins.map(p => p.manifest.id)
  }

  /**
   * Check if a plugin is enabled for the active companion
   */
  hasPlugin(pluginId: string): boolean {
    return this.plugins.some(p => p.manifest.id === pluginId)
  }

  /**
   * Switch to a different companion
   */
  async switchCompanion(slug: string): Promise<LoadedCompanion> {
    if (this.currentSlug === slug && this.cache) {
      log.log('Already on companion:', slug)
      return this.cache
    }

    log.log('Switching to companion:', slug)
    bus.emit('companion:loading', slug)

    try {
      const companion = await this.loadCompanion(slug)

      // Save the new active slug to storage
      await this.saveActiveSlug(slug)

      return companion
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      log.error('Failed to switch companion:', message)
      bus.emit('companion:error', { message, slug })
      throw error
    }
  }

  /**
   * Reload the current companion (e.g., after update)
   */
  async reload(): Promise<LoadedCompanion> {
    const slug = this.currentSlug || getDefaultCompanionId()
    this.cache = null
    return this.loadCompanion(slug)
  }

  /**
   * Get the current companion slug
   */
  getCurrentSlug(): string | null {
    return this.currentSlug
  }

  /**
   * Check if manager is initialized
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Internal: Load a companion and its plugins
   */
  private async loadCompanion(slug: string): Promise<LoadedCompanion> {
    log.log('Loading companion:', slug)

    // Load companion using existing loader
    const companion = await loadActiveCompanion(slug)

    // Update cache
    this.cache = companion
    this.currentSlug = companion.manifest.id

    // Load plugins based on capabilities
    const capabilities = companion.personality.capabilities
    this.plugins = await loadPluginsForCompanion(capabilities)

    log.log('Loaded companion:', companion.manifest.name, 'with plugins:', this.getEnabledPluginIds())

    // Emit change event
    bus.emit('companion:changed', {
      manifest: {
        id: companion.manifest.id,
        name: companion.manifest.name,
        version: companion.manifest.version,
      },
      personality: {
        name: companion.personality.name,
        traits: companion.personality.traits,
        systemPrompt: companion.personality.systemPrompt,
        capabilities: companion.personality.capabilities,
      },
    })

    return companion
  }

  /**
   * Get the stored active companion slug from Chrome storage
   */
  private async getStoredActiveSlug(): Promise<string | null> {
    try {
      const result = await chrome.storage.local.get('settings-store')
      const settingsJson = result['settings-store']
      if (!settingsJson) return null

      const settings = JSON.parse(settingsJson)
      return settings?.state?.activeCompanionSlug || null
    } catch (error) {
      log.warn('Failed to get stored active slug:', error)
      return null
    }
  }

  /**
   * Save the active companion slug to Chrome storage
   */
  private async saveActiveSlug(slug: string): Promise<void> {
    try {
      const result = await chrome.storage.local.get('settings-store')
      const settingsJson = result['settings-store']

      if (settingsJson) {
        const settings = JSON.parse(settingsJson)
        if (settings?.state) {
          settings.state.activeCompanionSlug = slug
          await chrome.storage.local.set({ 'settings-store': JSON.stringify(settings) })
        }
      }
    } catch (error) {
      log.warn('Failed to save active slug:', error)
    }
  }
}

// Singleton instance
export const companionManager = new CompanionManager()

// Re-export types for convenience
export type { LoadedCompanion, CompanionPersonality }
