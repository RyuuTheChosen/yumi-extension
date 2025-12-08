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
export interface PageContextInfo {
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

/**
 * Build unified system prompt for vision-based queries with personality integration
 * 
 * @param hasImage - Whether the query includes an image
 * @param personality - User's personality configuration
 * @param source - Source component ('selection-spotter', 'image-understanding', or other)
 * @returns Formatted vision system prompt with personality and analysis
 */
export function buildVisionChatSystemPrompt(hasImage: boolean, personality: any, source: string): string {
  const basePersonality = personality?.systemPrompt || DEFAULT_PERSONALITY.systemPrompt
  
  let prompt = `${basePersonality}

## Vision Analysis Mode
You're helping analyze ${hasImage ? 'images and text' : 'selected text'} from web pages.

Approach:
1. **Analyze thoroughly** - Understand the content deeply
2. **Respond naturally** - Use your friendly, conversational Yumi personality  
3. **Be genuinely helpful** - Provide insights users actually want

${hasImage ? 'For images: Describe what you see, extract any text (OCR), and explain significance.' : ''}
Stay curious, enthusiastic, and supportive in your responses.`

  return prompt
}

/**
 * Build system prompt for vision-based queries (pure analysis, no personality)
 * 
 * @param hasImage - Whether the query includes an image
 * @param source - Source component ('selection-spotter', 'image-understanding', or other)
 * @returns Formatted vision system prompt string for analytical response
 */
export function buildVisionSystemPrompt(hasImage: boolean, source: string): string {
  const timestamp = new Date().toLocaleString()
  
  let prompt = `You are an analytical AI assistant specialized in ${hasImage ? 'vision and text analysis' : 'text analysis'}.\n\n`
  
  prompt += `## Your Role\n`
  prompt += `Provide accurate, comprehensive analysis without conversational elements. Your output will be processed by another system for user delivery.\n\n`
  
  // Vision-specific framework
  if (hasImage) {
    prompt += `## Vision Analysis Framework\n`
    prompt += `Follow this systematic approach:\n`
    prompt += `1. **OCR Priority**: Extract and transcribe ALL visible text accurately\n`
    prompt += `2. **Visual Elements**: Describe layout, colors, design, UI components\n`
    prompt += `3. **Content Type**: Identify if it's code, design, chart, document, etc.\n`
    prompt += `4. **Context Analysis**: Connect visual elements to their purpose/meaning\n`
    prompt += `5. **Structured Output**: Organize findings clearly with headings\n`
    prompt += `6. **Actionable Insights**: Provide useful observations and interpretations\n\n`
  } else {
    prompt += `## Text Analysis Framework\n`
    prompt += `1. **Content Understanding**: Identify the main topic and context\n`
    prompt += `2. **Task Classification**: Determine if this is explanation, translation, summary, or analysis\n`
    prompt += `3. **Comprehensive Response**: Address all aspects of the user's query\n`
    prompt += `4. **Structured Output**: Use clear organization with headings if needed\n`
    prompt += `5. **Actionable Insights**: Provide useful observations\n\n`
  }
  
  // Response standards
  prompt += `## Output Standards\n`
  prompt += `- **Accuracy**: Provide precise, factual information\n`
  prompt += `- **Completeness**: Cover all relevant aspects thoroughly\n`
  prompt += `- **Clarity**: Use clear structure and appropriate detail\n`
  prompt += `- **Objectivity**: Focus on analysis, not conversational tone\n`
  
  // Source-specific task
  if (source === 'selection-spotter') {
    prompt += `\n\n**Current Task**: Analyze the selected text and respond to user instructions about it.`
  } else if (source === 'image-understanding') {
    prompt += `\n\n**Current Task**: Comprehensive image analysis with detailed OCR and visual description.`
  }
  
  prompt += `\n\n**Session**: ${timestamp}`
  
  return prompt
}
