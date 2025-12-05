/**
 * Builtin Plugins
 *
 * Exports all built-in plugins and provides a function to register them.
 */

import { registerPlugin } from '../registry'
import { searchPlugin } from './search'
import { memoryPlugin } from './memory'
import { ttsPlugin } from './tts'
import { visionPlugin } from './vision'

// Export individual plugins
export { searchPlugin } from './search'
export { memoryPlugin } from './memory'
export { ttsPlugin } from './tts'
export { visionPlugin } from './vision'

// All builtin plugins
export const builtinPlugins = [
  searchPlugin,
  memoryPlugin,
  ttsPlugin,
  visionPlugin,
]

/**
 * Register all builtin plugins with the registry.
 * Call this once during extension initialization.
 */
export function registerBuiltinPlugins(): void {
  for (const plugin of builtinPlugins) {
    registerPlugin(plugin)
  }
}
