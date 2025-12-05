// Plugin system public exports

// Types
export type {
  Plugin,
  PluginManifest,
  PluginState,
  TriggerResult,
  PromptContext,
  RegisteredPlugin,
  CompanionCapabilities,
  BuiltinPluginId,
} from './types'

export { BUILTIN_PLUGINS, companionCapabilitiesSchema } from './types'

// Registry
export {
  registerPlugin,
  registerPluginFactory,
  getPlugin,
  getRegisteredPluginIds,
  isPluginRegistered,
  getPluginState,
  updatePluginState,
  getAllPluginStates,
  clearRegistry,
} from './registry'

// Loader
export {
  loadPluginsForCompanion,
  getActivePlugins,
  getActivePluginIds,
  isPluginActive,
  getActivePlugin,
  getActivePluginStates,
  cleanupAllPlugins,
  buildPluginPromptAdditions,
  checkPluginTriggers,
} from './loader'

// React Context
export {
  PluginProvider,
  usePlugins,
  useHasPlugin,
  usePlugin,
} from './context'

// Builtin Plugins
export {
  builtinPlugins,
  registerBuiltinPlugins,
  searchPlugin,
  memoryPlugin,
  ttsPlugin,
  visionPlugin,
} from './builtin'
