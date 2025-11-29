/**
 * Vision Abilities Prompt Module
 *
 * Centralized prompts for Selection Spotter and Image Understanding.
 * Implements optimized two-stage pipeline:
 *   Stage 1: Fast analytical extraction (no personality)
 *   Stage 2: Personality delivery (streaming)
 *
 * Design principles:
 * - Stage 1 prompts are minimal and focused on extraction
 * - Stage 2 prompts focus purely on Yumi's delivery
 * - Clear separation of concerns for better quality
 */

import { DEFAULT_PERSONALITY } from '../personality'

// ============================================================================
// STAGE 1: ANALYTICAL EXTRACTION (No personality, fast, concise)
// ============================================================================

/**
 * Stage 1 prompt for image analysis
 * Goal: Extract facts quickly, no conversational fluff
 * Target: 150-300 tokens output, 5-8 seconds
 */
export function buildImageAnalysisPrompt(context: {
  altText: string
  pageTitle: string
  domain: string
  surroundingText: string
}): string {
  const { altText, pageTitle, domain, surroundingText } = context

  return `Analyze this image and extract information concisely.

## Context
- Page: ${pageTitle}
- Domain: ${domain}
- Alt text: "${altText || 'none'}"
${surroundingText ? `- Nearby text: "${surroundingText.slice(0, 200)}"` : ''}

## Output Format (use bullet points)
• TEXT: [Extract ALL visible text verbatim - this is critical]
• TYPE: [screenshot/photo/chart/meme/diagram/code/document/UI/other]
• MAIN ELEMENTS: [2-3 key things you observe]
• PURPOSE: [What this image appears to show or explain]
• NOTABLE: [Anything interesting, unusual, or important]

Be factual, thorough with text extraction, and brief with descriptions.
No conversational language - just analysis.`
}

/**
 * Stage 1 prompt for text selection analysis
 * Goal: Understand and analyze the selected text
 * Target: 100-250 tokens output, 3-6 seconds
 */
export function buildTextAnalysisPrompt(context: {
  selectedText: string
  instruction: string
  surroundingText: string
  pageTitle: string
}): string {
  const { selectedText, instruction, surroundingText, pageTitle } = context

  // Classify task type for optimized analysis
  const isTranslation = /translat|language|what does .* mean/i.test(instruction)
  const isSummary = /summar|tldr|brief|shorten/i.test(instruction)
  const isExplanation = /explain|what is|how does|why/i.test(instruction)
  const isCode = /code|function|bug|error|debug/i.test(instruction + selectedText)

  let taskGuidance = ''
  if (isTranslation) {
    taskGuidance = `Task type: TRANSLATION
- Identify the source language
- Provide accurate translation
- Note any idioms, cultural context, or nuances`
  } else if (isSummary) {
    taskGuidance = `Task type: SUMMARY
- Identify the main point/thesis
- Extract key supporting points
- Note important details or caveats`
  } else if (isCode) {
    taskGuidance = `Task type: CODE ANALYSIS
- Identify the programming language
- Explain what the code does
- Note any issues, patterns, or suggestions`
  } else if (isExplanation) {
    taskGuidance = `Task type: EXPLANATION
- Break down the concept clearly
- Identify prerequisites or context needed
- Note complexity level and key terms`
  } else {
    taskGuidance = `Task type: GENERAL ANALYSIS
- Understand the user's intent from their instruction
- Analyze the text thoroughly
- Provide relevant insights`
  }

  return `Analyze this text selection and prepare insights.

## User's Instruction
"${instruction}"

## Selected Text
"${selectedText}"

${surroundingText ? `## Page Context\n"${surroundingText.slice(0, 150)}..."` : ''}
${pageTitle ? `## Source: ${pageTitle}` : ''}

## ${taskGuidance}

## Output Format (bullet points)
• TASK: [What the user wants]
• KEY POINTS: [Main information from the text]
• ANALYSIS: [Your findings based on their instruction]
• EXTRAS: [Any helpful context, caveats, or related info]

Be analytical and thorough. No conversational language.`
}

// ============================================================================
// STAGE 2: PERSONALITY DELIVERY (Yumi's voice, streaming)
// ============================================================================

/**
 * Stage 2 prompt for delivering analysis in Yumi's voice
 * Goal: Transform analytical output into warm, conversational response
 * Target: First token <1s, full response 3-5 seconds
 */
export function buildPersonalityDeliveryPrompt(
  analyticalOutput: string,
  source: 'selection-spotter' | 'image-understanding',
  personality?: { systemPrompt?: string; traits?: string[] }
): string {
  const basePersonality = personality?.systemPrompt || DEFAULT_PERSONALITY.systemPrompt

  // Shorter personality excerpt for Stage 2 (we don't need the full thing)
  const personalityCore = `You are Yumi, a warm and friendly AI companion. You genuinely care about helping your user and have a playful, curious personality.`

  const voiceGuidelines = `## Your Voice
- Natural expressions: "Ooh!", "Oh interesting!", "Here's the thing...", "So basically..."
- Warm and engaged: Show genuine interest and care
- Conversational: Like explaining to a friend, not writing an essay
- Occasional emoji when it fits naturally (don't overdo it)
- Concise but complete: Respect their time while being helpful

## Anti-patterns (AVOID these)
- "Furthermore", "Moreover", "In conclusion" (too formal)
- Starting with "I" repeatedly
- Robotic bullet points in your response
- Overly long explanations
- Being dry or detached`

  const taskContext = source === 'image-understanding'
    ? `Your friend shared an image with you. Here's what you found in it:`
    : `Your friend highlighted some text and asked you about it. Here's what you found:`

  return `${personalityCore}

${voiceGuidelines}

## Your Task
${taskContext}

---
${analyticalOutput}
---

Now share your findings with your friend in your natural Yumi voice!
Be helpful, warm, and conversational. Keep it concise (2-4 sentences unless they need more detail).
Don't just repeat the bullet points - transform them into a friendly explanation.`
}

// ============================================================================
// SINGLE-STAGE FALLBACK (If two-stage is too slow or fails)
// ============================================================================

/**
 * Single-stage combined prompt (fallback)
 * Used when two-stage exceeds timeout or for simpler queries
 */
export function buildSingleStageVisionPrompt(
  hasImage: boolean,
  context: {
    prompt: string
    pageTitle?: string
    domain?: string
  },
  personality?: { systemPrompt?: string }
): string {
  const personalityCore = personality?.systemPrompt || DEFAULT_PERSONALITY.systemPrompt

  return `${personalityCore}

## Current Task
You're helping analyze ${hasImage ? 'an image' : 'selected text'} from: ${context.pageTitle || 'a webpage'}

## How to Respond
1. First, analyze thoroughly (extract text, identify key elements)
2. Then, share your findings in your natural Yumi voice
3. Be warm, helpful, and conversational
4. Keep it concise but complete

${hasImage ? `## For Images
- Extract ALL visible text (OCR is important!)
- Describe what you see
- Explain the significance or context` : ''}

Remember: You're Yumi - curious, caring, and friendly. Not a formal report generator.`
}

// ============================================================================
// API CONFIGURATION
// ============================================================================

/**
 * Optimized API parameters for each stage
 */
export const VISION_API_CONFIG = {
  stage1: {
    temperature: 0.3,      // Lower = more focused, deterministic
    max_tokens: 350,       // Enough for thorough extraction, not excessive
    presence_penalty: 0,   // No need for variety in analysis
    frequency_penalty: 0,  // Allow repetition if needed for accuracy
  },
  stage2: {
    temperature: 0.8,      // Higher = more personality, creativity
    max_tokens: 400,       // Concise responses
    presence_penalty: 0.4, // Encourage variety
    frequency_penalty: 0.3,// Reduce repetition
  },
  singleStage: {
    temperature: 0.7,
    max_tokens: 500,
    presence_penalty: 0.3,
    frequency_penalty: 0.2,
  },
  // Timeout before falling back to single-stage
  stage1TimeoutMs: 12000,  // 12 seconds max for Stage 1
}

// ============================================================================
// UX MESSAGES
// ============================================================================

/**
 * Status messages shown in FloatingBubble during processing
 */
export const VISION_UX_MESSAGES = {
  analyzing: 'Analyzing...',
  thinking: 'Yumi is thinking...',
  error: 'Oops, something went wrong',
  timeout: 'Taking longer than expected...',
  noApiKey: 'API key needed for this feature',
}
