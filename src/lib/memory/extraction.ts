/**
 * Memory Extraction Logic
 *
 * Extracts memorable facts from conversations using AI.
 * Handles deduplication, sensitive content filtering, and error handling.
 */

import type { Memory, MemoryType, ExtractedMemory, ExtractionResult } from './types'
import { EXTRACTION_CONFIG } from './types'
import {
  MEMORY_EXTRACTION_SYSTEM_PROMPT,
  buildExtractionPromptWithContext,
} from './prompts'

/**
 * Message format for extraction input
 */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  id?: string
  ts?: number
}

/**
 * Check if content contains sensitive patterns that should never be stored
 */
export function containsSensitiveContent(text: string): boolean {
  return EXTRACTION_CONFIG.sensitivePatterns.some((pattern) =>
    pattern.test(text)
  )
}

/**
 * Filter out any memories with sensitive content
 */
export function filterSensitiveMemories(
  memories: ExtractedMemory[]
): ExtractedMemory[] {
  return memories.filter((m) => {
    const isSensitive =
      containsSensitiveContent(m.content) ||
      (m.context && containsSensitiveContent(m.context))

    if (isSensitive) {
      console.log(
        '[Memory] Filtered sensitive memory:',
        m.content.slice(0, 30) + '...'
      )
    }

    return !isSensitive
  })
}

/**
 * Validate memory type is valid
 */
function isValidMemoryType(type: string): type is MemoryType {
  return [
    'identity',
    'preference',
    'skill',
    'project',
    'person',
    'event',
    'opinion',
  ].includes(type)
}

/**
 * Parse AI response into extracted memories
 */
export function parseExtractionResponse(response: string): ExtractedMemory[] {
  try {
    // Try to find JSON array in response (in case there's extra text)
    const jsonMatch = response.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      console.log('[Memory] No JSON array found in response')
      return []
    }

    const parsed = JSON.parse(jsonMatch[0])

    if (!Array.isArray(parsed)) {
      console.log('[Memory] Parsed result is not an array')
      return []
    }

    // Validate and normalize each memory
    const memories: ExtractedMemory[] = []

    for (const item of parsed) {
      // Validate required fields
      if (!item.type || !item.content) {
        console.log('[Memory] Skipping invalid memory (missing type or content)')
        continue
      }

      // Validate memory type
      if (!isValidMemoryType(item.type)) {
        console.log(`[Memory] Skipping invalid memory type: ${item.type}`)
        continue
      }

      // Normalize importance and confidence to 0-1 range
      const importance = Math.max(0, Math.min(1, Number(item.importance) || 0.5))
      const confidence = Math.max(0, Math.min(1, Number(item.confidence) || 0.5))

      // Skip low confidence memories
      if (confidence < 0.5) {
        console.log(
          `[Memory] Skipping low confidence memory: ${item.content.slice(0, 30)}... (${confidence})`
        )
        continue
      }

      memories.push({
        type: item.type,
        content: String(item.content).trim(),
        context: item.context ? String(item.context).trim() : undefined,
        importance,
        confidence,
      })
    }

    return memories
  } catch (err) {
    console.error('[Memory] Failed to parse extraction response:', err)
    return []
  }
}

/**
 * Extract memories from a conversation.
 * This function is called from the content script and sends a message
 * to the background service worker for API access.
 *
 * @param messages - Recent conversation messages to analyze
 * @param existingMemories - Current memories to avoid duplicates
 * @param conversationId - ID of the conversation for source tracking
 * @returns Extraction result with new memories
 */
export async function extractMemoriesFromConversation(
  messages: ConversationMessage[],
  existingMemories: Memory[],
  conversationId: string
): Promise<ExtractionResult> {
  // Filter to only user and assistant messages
  const relevantMessages = messages.filter(
    (m) => m.role === 'user' || m.role === 'assistant'
  )

  // Need at least one user message
  const hasUserMessage = relevantMessages.some((m) => m.role === 'user')
  if (!hasUserMessage) {
    return { memories: [], success: true }
  }

  // Build the extraction prompt
  const existingForPrompt = existingMemories.map((m) => ({
    type: m.type,
    content: m.content,
  }))

  const userPrompt = buildExtractionPromptWithContext(
    relevantMessages.map((m) => ({ role: m.role, content: m.content })),
    existingForPrompt
  )

  try {
    // Call background for API access
    const response = await callExtractionAPI(userPrompt)

    if (!response.success) {
      return {
        memories: [],
        success: false,
        error: response.error,
        raw: response.raw,
      }
    }

    // Parse the response
    let memories = parseExtractionResponse(response.raw || '')

    // Filter sensitive content
    memories = filterSensitiveMemories(memories)

    console.log(`[Memory] Extracted ${memories.length} memories from conversation`)

    return {
      memories,
      success: true,
      raw: response.raw,
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    console.error('[Memory] Extraction failed:', errorMessage)

    return {
      memories: [],
      success: false,
      error: errorMessage,
    }
  }
}

/**
 * Call the background service worker to run extraction API call
 * Uses sendMessage with callback pattern for proper content script communication
 */
async function callExtractionAPI(
  userPrompt: string
): Promise<{ success: boolean; raw?: string; error?: string }> {
  return new Promise((resolve) => {
    // Generate a unique request ID for logging
    const requestId = `memory-extract-${Date.now()}-${Math.random().toString(36).slice(2)}`
    let resolved = false

    // Timeout after 30 seconds (backup in case callback never fires)
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true
        console.error('[Memory] Extraction request timed out')
        resolve({
          success: false,
          error: 'Extraction request timed out',
        })
      }
    }, 30000)

    // Use sendMessage with callback - this properly returns response to content script
    chrome.runtime.sendMessage(
      {
        type: 'MEMORY_EXTRACTION',
        payload: {
          requestId,
          systemPrompt: MEMORY_EXTRACTION_SYSTEM_PROMPT,
          userPrompt,
        },
      },
      (response) => {
        if (resolved) return // Already timed out
        resolved = true
        clearTimeout(timeoutId)

        // Check for chrome runtime errors
        if (chrome.runtime.lastError) {
          console.error('[Memory] Runtime error:', chrome.runtime.lastError)
          resolve({
            success: false,
            error: chrome.runtime.lastError.message || 'Runtime error',
          })
          return
        }

        // Handle response from background
        if (response) {
          console.log('[Memory] Received extraction response:', response.success, 'raw length:', response.raw?.length)
          resolve(response)
        } else {
          console.error('[Memory] No response from background')
          resolve({
            success: false,
            error: 'No response from background',
          })
        }
      }
    )
  })
}

/**
 * Determine if extraction should run based on timing
 */
export function shouldExtract(
  lastExtractionAt: number | null,
  messageCount: number
): boolean {
  // Need at least a few messages
  if (messageCount < 2) {
    return false
  }

  // Check minimum interval
  if (lastExtractionAt) {
    const timeSinceLastExtraction = Date.now() - lastExtractionAt
    if (timeSinceLastExtraction < EXTRACTION_CONFIG.minExtractionInterval) {
      return false
    }
  }

  return true
}

/**
 * Get messages that haven't been processed yet
 */
export function getUnprocessedMessages(
  messages: ConversationMessage[],
  lastProcessedTimestamp: number
): ConversationMessage[] {
  return messages.filter((m) => {
    const ts = m.ts || 0
    return ts > lastProcessedTimestamp
  })
}
