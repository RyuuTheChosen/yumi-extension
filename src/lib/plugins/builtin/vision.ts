/**
 * Vision Plugin
 *
 * Wraps the existing vision/screenshot functionality as a plugin.
 * When enabled, the companion can analyze images and screenshots.
 */

import type { Plugin, PromptContext, TriggerResult } from '../types'

/**
 * Single-word triggers that need word-boundary matching
 * Prevents false positives like "screensaver" matching "screen"
 */
const WORD_TRIGGERS = ['screenshot', 'screen']

/**
 * Phrase triggers that use substring matching
 */
const PHRASE_TRIGGERS = [
  'look at this',
  'look at the',
  'look at my',
  'can you see',
  'what do you see',
  'show me',
  'take a look',
  'check this out',
  'see this',
  'see what',
  'look here',
  "what's on my screen",
  'what am i looking at',
  'what is this showing',
  'the image',
  'the picture',
  'the photo',
  'the chart',
  'the graph',
  'the diagram',
  'the layout',
  'the design',
  'the ui',
  'the interface',
  'analyze this',
  'analyze the',
  'describe this',
  'describe what',
  'read this image',
  'read the text',
  "what's this",
  'what does this show',
  'examine this',
]

/**
 * Patterns that indicate non-visual intent (false positive filters)
 * These are checked first to reject common phrases that shouldn't trigger vision
 */
const NEGATION_PATTERNS = [
  /\bcan'?t see\b/i,
  /\bdon'?t see\b/i,
  /\bwon'?t see\b/i,
  /\bsee what (you|i) mean\b/i,
  /\bsee (the |your )?point\b/i,
  /\bsee (you|ya)\b/i,
  /\bscreensaver\b/i,
]

/**
 * Check if word matches with word boundaries (not substring)
 */
function matchesWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, 'i').test(text)
}

/**
 * Check if the query requests visual/screenshot analysis
 * Uses negation patterns to filter false positives, then checks triggers
 */
function isVisionQuery(query: string): boolean {
  const lower = query.toLowerCase()

  if (NEGATION_PATTERNS.some(p => p.test(lower))) {
    return false
  }

  for (const word of WORD_TRIGGERS) {
    if (matchesWord(lower, word)) return true
  }

  for (const phrase of PHRASE_TRIGGERS) {
    if (lower.includes(phrase)) return true
  }

  return false
}

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
