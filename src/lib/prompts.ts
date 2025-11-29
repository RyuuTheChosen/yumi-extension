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

/**
 * Page context info passed to prompt builder
 */
export interface PageContextInfo {
  pageType?: string
  pageContext?: string  // Pre-built context string from buildContextForPrompt() (deprecated)
  selectedContext?: string  // User-selected content from right-click context menu
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

  // Add memory context if available
  if (memoryContext && memoryContext.trim()) {
    prompt += `\n\n## Long-Term Memory\n`
    prompt += `${memoryContext}\n\n`
    prompt += `**Memory Guidelines:**\n`
    prompt += `- Reference memories naturally when relevant (e.g., "I remember you mentioned...")\n`
    prompt += `- Use memories to personalize responses and show you care\n`
    prompt += `- Don't force memories into every response - only when genuinely relevant\n`
    prompt += `- If a memory seems outdated or wrong, ask to confirm\n`
  }

  // Add user-selected context from right-click menu (primary method)
  if (pageInfo?.selectedContext && pageInfo.selectedContext.trim()) {
    prompt += `\n\n## User-Selected Content\n`
    prompt += `The user has selected the following content for you to read and discuss:\n\n`
    prompt += `---\n${pageInfo.selectedContext}\n---\n\n`
    prompt += `**IMPORTANT - You MUST:**\n`
    prompt += `- Immediately read and acknowledge the content above\n`
    prompt += `- Discuss, analyze, or comment on it based on the user's message\n`
    prompt += `- Reference specific details from the content in your response\n`
    prompt += `- If the user just says "read this" or similar, summarize and share your thoughts\n`
    prompt += `- Never ask "what would you like me to read?" - you already have the content\n`
  }

  // Legacy: Add page context if available (for backwards compatibility)
  if (pageInfo?.pageContext && pageInfo.pageContext.trim() && !pageInfo?.selectedContext) {
    prompt += `\n\n## Current Page Context\n`
    prompt += `The user is currently viewing a **${pageInfo.pageType || 'web'}** page.\n\n`
    prompt += pageInfo.pageContext + '\n\n'
    prompt += `**Page Context Guidelines:**\n`
    prompt += `- Use this context to understand what the user is looking at\n`
    prompt += `- Reference specific details from the page when answering questions about it\n`
    prompt += `- If the user's question relates to the page content, leverage this context\n`
    prompt += `- Don't mention "page context" explicitly - just naturally incorporate the knowledge\n`
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
