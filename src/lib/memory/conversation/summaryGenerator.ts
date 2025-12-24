/**
 * Conversation Summary Generator
 *
 * Generates summaries of conversations using the Hub API.
 * Used to provide context for past conversations when memories are retrieved.
 */

import type { ConversationSummary } from '../types'
import { SUMMARY_CONFIG } from '../types'
import { createLogger } from '../../core/debug'

const log = createLogger('SummaryGenerator')

/**
 * Message format for summary generation
 */
export interface SummaryMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Result from summary generation
 */
export interface SummaryGenerationResult {
  success: boolean
  summary?: string
  keyTopics?: string[]
  error?: string
}

/**
 * Generate a summary for a conversation.
 * Sends messages to background worker for Hub API processing.
 *
 * @param messages - Conversation messages to summarize
 * @param conversationId - ID of the conversation
 * @returns Summary generation result
 */
export async function generateConversationSummary(
  messages: SummaryMessage[],
  conversationId: string
): Promise<SummaryGenerationResult> {
  if (messages.length < SUMMARY_CONFIG.minMessagesForSummary) {
    return {
      success: false,
      error: `Conversation too short (${messages.length} < ${SUMMARY_CONFIG.minMessagesForSummary} messages)`
    }
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'SUMMARY_GENERATE',
      payload: {
        messages,
        conversationId,
        maxLength: SUMMARY_CONFIG.maxSummaryLength,
        maxTopics: SUMMARY_CONFIG.maxKeyTopics
      }
    })

    if (!response.success) {
      log.warn('[SummaryGenerator] Generation failed:', response.error)
      return {
        success: false,
        error: response.error || 'Summary generation failed'
      }
    }

    return {
      success: true,
      summary: response.summary,
      keyTopics: response.keyTopics
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('[SummaryGenerator] Failed to generate summary:', err)
    return {
      success: false,
      error: message
    }
  }
}

/**
 * Create a ConversationSummary object from generation result
 */
export function createSummaryObject(
  conversationId: string,
  result: SummaryGenerationResult,
  options: {
    memoryIds: string[]
    messageCount: number
    url?: string
    startTime: number
    endTime: number
  }
): ConversationSummary | null {
  if (!result.success || !result.summary) {
    return null
  }

  return {
    id: `summary-${conversationId}`,
    conversationId,
    summary: result.summary,
    keyTopics: result.keyTopics || [],
    memoryIds: options.memoryIds,
    messageCount: options.messageCount,
    url: options.url,
    conversationStartedAt: options.startTime,
    conversationEndedAt: options.endTime,
    createdAt: Date.now()
  }
}

/**
 * Check if a conversation should have a summary generated
 */
export function shouldGenerateSummary(messageCount: number, existingSummary: boolean): boolean {
  if (existingSummary) {
    return false
  }

  return messageCount >= SUMMARY_CONFIG.minMessagesForSummary
}

/**
 * Format messages for display in summary context
 */
export function formatMessagesPreview(messages: SummaryMessage[], maxLength: number = 200): string {
  const userMessages = messages
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .join(' ')

  if (userMessages.length <= maxLength) {
    return userMessages
  }

  return userMessages.slice(0, maxLength - 3) + '...'
}
