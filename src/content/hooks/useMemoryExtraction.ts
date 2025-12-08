/**
 * Memory Extraction Hook
 *
 * Automatically extracts memories from conversations after idle period.
 * Handles TTS fallback when streaming TTS fails, and manages extraction timing.
 */

import { useEffect, useRef } from 'react'
import { createLogger } from '../../lib/core/debug'
import { bus } from '../../lib/core/bus'
import { ttsService } from '../../lib/tts'
import {
  extractMemoriesFromConversation,
  shouldExtract,
  EXTRACTION_CONFIG,
  useMemoryStore,
} from '../../lib/memory'
import type { Message } from '../../types'

const log = createLogger('useMemoryExtraction')

export interface UseMemoryExtractionOptions {
  status: 'idle' | 'sending' | 'streaming' | 'error' | 'canceled'
  displayMessages: Message[]
  currentScopeId: string
  ttsEnabled: boolean
  streamingTtsFailedRef: React.MutableRefObject<boolean>
}

/**
 * Custom hook for automatic memory extraction
 *
 * Extracts memories from conversations after idle period.
 * Features:
 * - Waits 30s after streaming ends before extracting
 * - Falls back to non-streaming TTS if streaming failed
 * - Adds source info to extracted memories
 * - Emits avatar state events (thinking, speaking)
 */
export function useMemoryExtraction(options: UseMemoryExtractionOptions): void {
  const {
    status,
    displayMessages,
    currentScopeId,
    ttsEnabled,
    streamingTtsFailedRef
  } = options

  const extractionTimerRef = useRef<number | null>(null)
  const prevStatusRef = useRef<string>(status)
  const extractionScheduledRef = useRef<boolean>(false)

  const addMemories = useMemoryStore(s => s.addMemories)
  const setLastExtractionAt = useMemoryStore(s => s.setLastExtractionAt)

  useEffect(() => {
    const wasStreaming = prevStatusRef.current === 'streaming'
    const wasIdle = prevStatusRef.current === 'idle'
    prevStatusRef.current = status

    if (wasIdle && status === 'streaming') {
      bus.emit('avatar', { type: 'thinking:start' })
    }

    if (wasStreaming && status === 'idle') {
      log.log('[useMemoryExtraction] Stream ended, scheduling extraction in 30s...')

      bus.emit('avatar', { type: 'thinking:stop' })

      if (ttsEnabled && displayMessages.length > 0 && streamingTtsFailedRef.current) {
        const lastMessage = displayMessages[displayMessages.length - 1]
        if (lastMessage.role === 'assistant' && lastMessage.content) {
          log.log('[useMemoryExtraction] Streaming TTS failed, falling back to non-streaming TTS...')

          bus.emit('avatar', { type: 'speaking:start' })
          ttsService.speak(lastMessage.content)
            .then(() => {
              bus.emit('avatar', { type: 'speaking:stop' })
            })
            .catch(err => {
              log.error('[useMemoryExtraction] TTS failed:', err)
              bus.emit('avatar', { type: 'speaking:stop' })
            })
        }
      }

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
  }, [status, displayMessages, currentScopeId, addMemories, setLastExtractionAt, ttsEnabled, streamingTtsFailedRef])

  useEffect(() => {
    return () => {
      if (extractionTimerRef.current && !extractionScheduledRef.current) {
        clearTimeout(extractionTimerRef.current)
      }
    }
  }, [])
}
