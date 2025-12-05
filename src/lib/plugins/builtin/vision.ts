/**
 * Vision Plugin
 *
 * Wraps the existing vision/screenshot functionality as a plugin.
 * When enabled, the companion can analyze images and screenshots.
 */

import type { Plugin, PromptContext, TriggerResult } from '../types'
import { isVisionQuery } from '../../context/visionTrigger'

export const visionPlugin: Plugin = {
  manifest: {
    id: 'vision',
    name: 'Vision & Screenshots',
    description: 'Analyze images and take screenshots of web pages',
    version: '1.0.0',
  },

  getPromptAdditions: (context: PromptContext) => {
    return `## Vision Capabilities
You can see and analyze:
- Screenshots of the current page (when the user asks you to "look at" or "see" something)
- Images shared via right-click context menu
- Selected text and elements on web pages

When analyzing visual content:
- Describe what you see clearly and accurately
- Extract any text visible in images (OCR)
- Provide helpful insights based on the visual context
- If you can't see something clearly, say so`
  },

  analyzeTrigger: (message: string): TriggerResult | null => {
    if (isVisionQuery(message)) {
      return {
        pluginId: 'vision',
        type: 'vision_query',
        confidence: 0.7,
        data: { needsScreenshot: true },
      }
    }
    return null
  },

  // Vision services are handled by the vision abilities module
  // This plugin mainly provides the prompt additions and trigger detection
  services: {
    // Placeholder - actual vision operations handled separately
  },
}

export default visionPlugin
