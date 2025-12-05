import { z } from 'zod'
import type { ComponentType } from 'react'

/**
 * Plugin System Types
 *
 * Plugins are modular features that companions can enable/disable.
 * Each plugin can provide:
 * - Prompt additions (AI capabilities)
 * - Services (API calls, data fetching)
 * - UI components (widgets, settings panels)
 * - Trigger detection (intent matching)
 * - Message handlers (background script communication)
 */

// Plugin manifest - identifies the plugin
export interface PluginManifest {
  id: string
  name: string
  description: string
  version: string
}

// Trigger result when plugin detects user intent
export interface TriggerResult {
  pluginId: string
  type: string
  confidence: number
  data?: Record<string, unknown>
}

// Prompt context passed to getPromptAdditions
export interface PromptContext {
  companionName: string
  pageUrl?: string
  pageTitle?: string
  hasMemories: boolean
}

// Plugin definition
export interface Plugin {
  manifest: PluginManifest

  // Lifecycle hooks
  initialize?: () => Promise<void>
  cleanup?: () => void

  // Prompt additions - what the AI knows it can do
  getPromptAdditions?: (context: PromptContext) => string

  // Services - callable functions
  services?: Record<string, (...args: unknown[]) => Promise<unknown>>

  // UI components
  uiComponents?: {
    chatWidget?: ComponentType
    settingsPanel?: ComponentType
  }

  // Intent detection - analyze user message for plugin-specific triggers
  analyzeTrigger?: (message: string) => TriggerResult | null

  // Background message handlers - for chrome.runtime messages
  messageHandlers?: Record<string, (payload: unknown) => Promise<unknown>>
}

// Plugin state (runtime)
export interface PluginState {
  id: string
  enabled: boolean
  initialized: boolean
  error?: string
}

// Built-in plugin IDs
export const BUILTIN_PLUGINS = ['search', 'memory', 'tts', 'vision'] as const
export type BuiltinPluginId = (typeof BUILTIN_PLUGINS)[number]

// Capabilities schema for personality.json
export const companionCapabilitiesSchema = z.object({
  plugins: z.array(z.string()).default([]),
  // Plugin-specific config can be added here
  // e.g., crypto: { features: [...], defaultChains: [...] }
}).optional()

export type CompanionCapabilities = z.infer<typeof companionCapabilitiesSchema>

// Plugin registry entry
export interface RegisteredPlugin {
  plugin: Plugin
  factory?: () => Plugin
}
