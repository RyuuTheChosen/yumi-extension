/**
 * Prompt Engineering Module
 *
 * Centralized prompt builders for all AI interactions.
 * Implements research-backed prompt engineering patterns:
 * - Structured prompts with clear sections
 * - Context-aware adaptations
 * - Personality trait integration
 * - Task-specific frameworks
 * - Memory integration for personalization
 */

import { assembleSystemPrompt, DEFAULT_PERSONALITY, createPersonality } from './personality'
import { buildPluginPromptAdditions as getPluginPromptAdditions } from './plugins/loader'

/**
 * Page context info passed to prompt builder
 */
interface PageContextInfo {
  pageType?: string
  pageUrl?: string
  pageTitle?: string
  pageContent?: string
  selectedContext?: string
  searchContext?: string
}

/**
 * Context injection options for runtime prompt enhancement
 */
interface ContextInjectionOptions {
  memoryContext?: string
  selectedContext?: string
  searchContext?: string
}

/**
 * Inject runtime context (memory, selection, search) into a prompt
 * Shared logic for consistent context formatting across different prompt types
 */
function injectRuntimeContext(
  prompt: string,
  options: ContextInjectionOptions
): string {
  let result = prompt

  // Memory context
  if (options.memoryContext?.trim()) {
    result += `\n\n## Long-Term Memory\n`
    result += `${options.memoryContext}\n\n`
    result += `**Memory Guidelines:**\n`
    result += `- Reference memories naturally when relevant (e.g., "I remember you mentioned...")\n`
    result += `- Use memories to personalize responses and show you care\n`
    result += `- Don't force memories into every response - only when genuinely relevant\n`
    result += `- If a memory seems outdated or wrong, ask to confirm\n`
  }

  // Selected context
  if (options.selectedContext?.trim()) {
    result += `\n\n## User-Selected Content\n`
    result += `The user has selected the following content for you to read and discuss:\n\n`
    result += `---\n${options.selectedContext}\n---\n\n`
    result += `**IMPORTANT - You MUST:**\n`
    result += `- Immediately read and acknowledge the content above\n`
    result += `- Discuss, analyze, or comment on it based on the user's message\n`
    result += `- Reference specific details from the content in your response\n`
    result += `- If the user just says "read this" or similar, summarize and share your thoughts\n`
    result += `- Never ask "what would you like me to read?" - you already have the content\n`
  }

  // Search context
  if (options.searchContext?.trim()) {
    result += `\n\n${options.searchContext}`
  }

  return result
}

/**
 * Build system prompt for regular chat interactions
 *
 * @param personality - User's personality configuration
 * @param historyLength - Number of messages in conversation history
 * @param memoryContext - Optional formatted memory context string
 * @param pageInfo - Optional page context information
 * @returns Formatted system prompt string
 */
export function buildChatSystemPrompt(
  personality: any,
  historyLength: number,
  memoryContext?: string,
  pageInfo?: PageContextInfo
): string {
  const hasHistory = historyLength > 0

  // Use assembleSystemPrompt from personality.ts as the single source of truth
  // This now includes all personality-specific content (examples, voice guidelines, etc.)
  let prompt = ''

  if (personality?.systemPrompt) {
    // Custom personality - use assembleSystemPrompt for consistent trait handling
    // Include examples only for default Yumi personality
    prompt = assembleSystemPrompt(personality, true)
  } else {
    // Default personality - create temporary personality object and assemble it
    const defaultPersonality = createPersonality({
      name: DEFAULT_PERSONALITY.name,
      systemPrompt: DEFAULT_PERSONALITY.systemPrompt,
      avatar: DEFAULT_PERSONALITY.avatar,
      traits: DEFAULT_PERSONALITY.traits
    })
    prompt = assembleSystemPrompt(defaultPersonality, true)
  }

  // Inject runtime context (memory, selection, search)
  prompt = injectRuntimeContext(prompt, {
    memoryContext,
    selectedContext: pageInfo?.selectedContext,
    searchContext: pageInfo?.searchContext,
  })

  // Add plugin-specific prompt additions
  const companionName = personality?.name || DEFAULT_PERSONALITY.name
  const pluginAdditions = getPluginPromptAdditions({
    companionName,
    pageUrl: pageInfo?.pageUrl,
    pageTitle: pageInfo?.pageTitle,
    hasMemories: !!memoryContext?.trim(),
  })

  if (pluginAdditions) {
    prompt += `\n\n## Active Capabilities\n${pluginAdditions}`
  }

  // Add current page context - critical for awareness
  if (pageInfo?.pageUrl || pageInfo?.pageTitle || pageInfo?.pageContent) {
    prompt += `\n\n## Current Page\n`
    prompt += `The user is currently browsing:\n`
    if (pageInfo.pageTitle) {
      prompt += `- **Title**: ${pageInfo.pageTitle}\n`
    }
    if (pageInfo.pageUrl) {
      prompt += `- **URL**: ${pageInfo.pageUrl}\n`
    }
    if (pageInfo.pageContent) {
      prompt += `\n**Page Content:**\n${pageInfo.pageContent}\n`
    }
    prompt += `\nUse this context to answer questions about what they're viewing. You CAN see the page content above.\n`
  }

  // Add conversational context (the only dynamic part)
  prompt += `\n\n## Current Session\n`
  if (hasHistory) {
    prompt += `- **Conversation**: Continuing our ongoing discussion (${historyLength} previous messages)\n`
    prompt += `- **Continuity**: Reference relevant parts of our conversation history naturally\n`
  } else {
    prompt += `- **Session**: Starting a new conversation\n`
    prompt += `- **Approach**: Be welcoming and establish rapport\n`
  }
  prompt += `- **Privacy**: All conversations are private and secure\n`

  return prompt
}
