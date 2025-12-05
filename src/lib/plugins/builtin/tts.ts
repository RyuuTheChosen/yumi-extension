/**
 * TTS Plugin
 *
 * Wraps the existing text-to-speech functionality as a plugin.
 * When enabled, the companion can speak responses aloud.
 */

import type { Plugin, PromptContext } from '../types'

export const ttsPlugin: Plugin = {
  manifest: {
    id: 'tts',
    name: 'Text-to-Speech',
    description: 'Speak responses aloud with voice synthesis',
    version: '1.0.0',
  },

  getPromptAdditions: (context: PromptContext) => {
    // TTS doesn't add to the AI prompt - it's a delivery mechanism
    // The companion doesn't need to know it's being spoken aloud
    return ''
  },

  // TTS services are handled by ttsService and StreamingTTSService directly
  // This plugin mainly enables/disables the feature per companion
  services: {
    // Placeholder - actual TTS operations use ttsService
  },
}

export default ttsPlugin
