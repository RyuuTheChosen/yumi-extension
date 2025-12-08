/**
 * Search Plugin
 *
 * Wraps the existing web search functionality as a plugin.
 * When enabled, the companion can search the web for current information.
 */

import type { Plugin, PromptContext, TriggerResult } from '../types'

export const searchPlugin: Plugin = {
  manifest: {
    id: 'search',
    name: 'Web Search',
    description: 'Search the web for current information',
    version: '1.0.0',
  },

  getPromptAdditions: (_context: PromptContext) => {
    return `## Web Search Capability
You can search the web for current, up-to-date information. When the user asks about:
- Recent news or events
- Current prices, statistics, or data
- Information that may have changed since your training
- Topics where fresh information would be helpful

You have access to real-time web search results that will be provided in the context.
Let the user know when you're using search results to answer their question.`
  },

  analyzeTrigger: (_message: string): TriggerResult | null => {
    /** Search is now toggle-based in MessageInput, no auto-detection needed */
    return null
  },
}

export default searchPlugin
