/**
 * Memory Extraction Hook
 *
 * Automatically extracts memories from conversations after idle period.
 */

import { useEffect, useRef } from 'react'
import { createLogger } from '../../lib/core/debug'
import {
  extractMemoriesFromConversation,
  shouldExtract,
  EXTRACTION_CONFIG,
  useMemoryStore,
} from '../../lib/memory'
import type { Message } from '../../types'
import { isPluginActive } from '../../lib/plugins/loader'

const log = createLogger('useMemoryExtraction')

export interface UseMemoryExtractionOptions {
  status: 'idle' | 'sending' | 'streaming' | 'error' | 'canceled'
  displayMessages: Message[]
  currentScopeId: string
}

/**
 * Custom hook for automatic memory extraction
 *
 * Extracts memories from conversations after idle period.
 * Features:
 * - Waits 30s after streaming ends before extracting
 * - Adds source info to extracted memories
 */
export function useMemoryExtraction(options: UseMemoryExtractionOptions): void {
  const {
    status,
    displayMessages,
    currentScopeId,
  } = options

  const extractionTimerRef = useRef<number | null>(null)
  const prevStatusRef = useRef<string>(status)
  const extractionScheduledRef = useRef<boolean>(false)

  const addMemories = useMemoryStore(s => s.addMemories)
  const setLastExtractionAt = useMemoryStore(s => s.setLastExtractionAt)

  useEffect(() => {
    if (!isPluginActive('memory')) {
      return
    }

    const wasStreaming = prevStatusRef.current === 'streaming'
    prevStatusRef.current = status

    if (wasStreaming && status === 'idle') {
      log.log('[useMemoryExtraction] Stream ended, scheduling extraction in 30s...')

      if (extractionTimerRef.current) {
        clearTimeout(extractionTimerRef.current)
      }

      extractionScheduledRef.current = true

      extractionTimerRef.current = window.setTimeout(async () => {
        extractionScheduledRef.current = false
        const memoryStore = useMemoryStore.getState()

        if (!shouldExtract(memoryStore.lastExtractionAt, displayMessages.length)) {
          log.log('[useMemoryExtraction] Skipping extraction (too soon or not enough messages)')
          return
        }

        log.log('[useMemoryExtraction] Triggering memory extraction...')
        log.log('[useMemoryExtraction] displayMessages count:', displayMessages.length)

        const recentMessages = displayMessages.slice(-EXTRACTION_CONFIG.batchSize).map(m => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
          id: m.id,
          ts: m.ts,
        }))

        log.log('[useMemoryExtraction] Sending messages for extraction:', recentMessages.map(m => ({
          role: m.role,
          contentPreview: m.content.substring(0, 100) + (m.content.length > 100 ? '...' : '')
        })))

        const result = await extractMemoriesFromConversation(
          recentMessages,
          memoryStore.memories,
          currentScopeId
        )

        log.log('[useMemoryExtraction] Extraction result:', result.success, 'memories:', result.memories.length)
        if (result.raw) {
          log.log('[useMemoryExtraction] Raw extraction response:', result.raw)
        }

        if (result.success && result.memories.length > 0) {
          const memoriesWithSource = result.memories.map(m => ({
            ...m,
            source: {
              conversationId: currentScopeId,
              messageId: recentMessages[recentMessages.length - 1]?.id || '',
              url: window.location.href,
              timestamp: Date.now(),
            }
          }))

          await addMemories(memoriesWithSource)
          log.log(`[useMemoryExtraction] Extracted and saved ${result.memories.length} memories`)
        } else if (!result.success) {
          log.error('[useMemoryExtraction] Extraction failed:', result.error)
        }

        setLastExtractionAt(Date.now())
      }, EXTRACTION_CONFIG.idleDelayMs)
    }
  }, [status, displayMessages, currentScopeId, addMemories, setLastExtractionAt])

  useEffect(() => {
    return () => {
      if (extractionTimerRef.current && !extractionScheduledRef.current) {
        clearTimeout(extractionTimerRef.current)
      }
    }
  }, [])
}
