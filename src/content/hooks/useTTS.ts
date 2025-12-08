/**
 * Text-to-Speech Hook
 *
 * Handles both non-streaming TTS initialization and real-time streaming TTS.
 * Manages WebSocket connection, sentence boundary detection, and lip sync integration.
 */

import { useEffect, useRef } from 'react'
import { createLogger } from '../../lib/core/debug'
import { ttsService } from '../../lib/tts'
import { StreamingTTSService, extractCompleteSentences } from '../../lib/tts/streamingTts'
import { bus } from '../../lib/core/bus'
import { getActiveCompanion } from '../../lib/companions/loader'

const log = createLogger('useTTS')

export interface UseTTSOptions {
  enabled: boolean
  volume: number
  activeCompanionSlug: string
  hubUrl?: string
  hubAccessToken?: string | null
  status: 'idle' | 'sending' | 'streaming' | 'error' | 'canceled'
}

export interface UseTTSReturn {
  streamingTtsRef: React.MutableRefObject<StreamingTTSService | null>
  streamingTtsFailedRef: React.MutableRefObject<boolean>
}

/**
 * Custom hook for TTS management
 *
 * Initializes non-streaming TTS service and manages streaming TTS WebSocket connection.
 * Handles sentence buffering, lip sync integration, and fallback when streaming fails.
 */
export function useTTS(options: UseTTSOptions): UseTTSReturn {
  const {
    enabled,
    volume,
    activeCompanionSlug,
    hubUrl,
    hubAccessToken,
    status
  } = options

  const streamingTtsRef = useRef<StreamingTTSService | null>(null)
  const sentenceBufferRef = useRef<string>('')
  const streamingTtsFailedRef = useRef<boolean>(false)

  /**
   * Initialize non-streaming TTS service with Hub credentials and companion voice
   */
  useEffect(() => {
    if (!enabled) {
      log.log('[useTTS] TTS disabled')
      return
    }

    if (!hubUrl || !hubAccessToken) {
      log.log('[useTTS] TTS enabled but not logged in to Hub')
      return
    }

    const initTTS = async () => {
      try {
        const companion = await getActiveCompanion(activeCompanionSlug)
        const voiceId = companion.personality.voice?.voiceId || 'MEJe6hPrI48Kt2lFuVe3'

        ttsService.initialize(hubUrl, hubAccessToken, {
          enabled,
          voice: voiceId,
          volume,
        })
        log.log('[useTTS] TTS initialized with companion voice:', voiceId)
      } catch (err) {
        log.error('[useTTS] Failed to load companion for TTS:', err)
      }
    }

    initTTS()
  }, [enabled, volume, activeCompanionSlug, hubUrl, hubAccessToken])

  /**
   * Streaming TTS: Play audio as text streams in real-time
   *
   * - Connects to WebSocket when streaming starts
   * - Buffers text and sends complete sentences
   * - Integrates with lip sync animation
   * - Falls back to non-streaming if connection fails
   */
  useEffect(() => {
    if (!enabled || !hubUrl || !hubAccessToken) {
      return
    }

    let streamUnsubscribe: (() => void) | null = null
    let currentVoiceId = ''

    const startStreamingTTS = async () => {
      sentenceBufferRef.current = ''
      streamingTtsFailedRef.current = false

      let wsReady = false
      let pendingSentences: string[] = []

      streamUnsubscribe = bus.on('stream', (delta: string) => {
        sentenceBufferRef.current += delta
        const { sentences, remaining } = extractCompleteSentences(sentenceBufferRef.current)
        sentenceBufferRef.current = remaining

        for (const sentence of sentences) {
          if (sentence.trim()) {
            if (wsReady && streamingTtsRef.current) {
              streamingTtsRef.current.sendText(sentence)
            } else {
              pendingSentences.push(sentence)
            }
          }
        }
      })

      try {
        const companion = await getActiveCompanion(activeCompanionSlug)
        currentVoiceId = companion.personality.voice?.voiceId || 'MEJe6hPrI48Kt2lFuVe3'
      } catch {
        currentVoiceId = 'MEJe6hPrI48Kt2lFuVe3'
      }

      streamingTtsRef.current = new StreamingTTSService(hubUrl, hubAccessToken, {
        enabled: true,
        voice: currentVoiceId,
        volume,
        speed: 1.0,
      })

      const connected = await streamingTtsRef.current.connect()
      if (!connected) {
        log.warn('[useTTS] Streaming TTS connection failed, will fall back to non-streaming')
        streamingTtsFailedRef.current = true
        streamingTtsRef.current.destroy()
        streamingTtsRef.current = null
        return
      }

      log.log('[useTTS] Streaming TTS connected')

      wsReady = true
      if (pendingSentences.length > 0) {
        log.log(`[useTTS] Sending ${pendingSentences.length} buffered sentences`)
        for (const sentence of pendingSentences) {
          streamingTtsRef.current.sendText(sentence)
        }
        pendingSentences = []
      }

      bus.emit('avatar', { type: 'speaking:start' })

      const analyser = streamingTtsRef.current.getAnalyserNode()
      let disconnectLipSync: (() => void) | null = null
      if (analyser) {
        const connectLipSync = (window as { __yumiConnectStreamingAnalyser?: (a: AnalyserNode) => () => void }).__yumiConnectStreamingAnalyser
        if (connectLipSync) {
          disconnectLipSync = connectLipSync(analyser)
          log.log('[useTTS] Streaming lip sync connected')
        }
      }

      streamingTtsRef.current.onAudioEnd(() => {
        log.log('[useTTS] Streaming TTS audio finished, closing connection')
        if (disconnectLipSync) {
          disconnectLipSync()
        }
        bus.emit('avatar', { type: 'speaking:stop' })
        if (streamingTtsRef.current) {
          streamingTtsRef.current.destroy()
          streamingTtsRef.current = null
        }
      })
    }

    const stopStreamingTTS = () => {
      if (streamUnsubscribe) {
        streamUnsubscribe()
        streamUnsubscribe = null
      }

      if (streamingTtsRef.current && sentenceBufferRef.current.trim()) {
        log.log('[useTTS] Flushing remaining text, waiting for audio...')
        streamingTtsRef.current.sendText(sentenceBufferRef.current, true)
        sentenceBufferRef.current = ''
      }

      if (streamingTtsRef.current && streamingTtsFailedRef.current) {
        streamingTtsRef.current.close()
      }
    }

    if (status === 'streaming') {
      startStreamingTTS()
    }

    return () => {
      stopStreamingTTS()
    }
  }, [status, enabled, hubUrl, hubAccessToken, volume, activeCompanionSlug])

  return {
    streamingTtsRef,
    streamingTtsFailedRef
  }
}
