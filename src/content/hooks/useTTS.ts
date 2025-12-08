/**
 * Text-to-Speech Hook
 *
 * Handles both non-streaming TTS initialization and real-time streaming TTS.
 * Manages WebSocket connection, sentence boundary detection, and lip sync integration.
 */

import { useEffect, useRef } from 'react'
import { createLogger } from '../../lib/core/debug'
import { ttsService, ttsCoordinator } from '../../lib/tts'
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
  const busUnsubRef = useRef<(() => void) | null>(null)
  const busStreamEndUnsubRef = useRef<(() => void) | null>(null)
  const fullTextBufferRef = useRef<string>('')
  const pendingSentencesRef = useRef<string[]>([])
  const wsReadyRef = useRef<boolean>(false)
  const statusRef = useRef(status)
  const isStreamingActiveRef = useRef(false)

  statusRef.current = status

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
   * Streaming TTS: Set up bus subscription for stream events
   *
   * Creates subscription immediately when TTS is enabled (not tied to status)
   * to avoid race condition where status changes before effect runs.
   * Resets buffers when a new stream starts (status becomes 'sending').
   */
  useEffect(() => {
    if (!enabled || !hubUrl || !hubAccessToken) {
      if (busUnsubRef.current) {
        busUnsubRef.current()
        busUnsubRef.current = null
      }
      if (busStreamEndUnsubRef.current) {
        busStreamEndUnsubRef.current()
        busStreamEndUnsubRef.current = null
      }
      return
    }

    if (!busUnsubRef.current) {
      busUnsubRef.current = bus.on('stream', (delta: string) => {
        if (!isStreamingActiveRef.current) {
          sentenceBufferRef.current = ''
          fullTextBufferRef.current = ''
          pendingSentencesRef.current = []
          wsReadyRef.current = false
          streamingTtsFailedRef.current = false
          isStreamingActiveRef.current = true
          log.log('[useTTS] Stream started, buffers reset')
        }

        sentenceBufferRef.current += delta
        fullTextBufferRef.current += delta
        const { sentences, remaining } = extractCompleteSentences(sentenceBufferRef.current)
        sentenceBufferRef.current = remaining

        for (const sentence of sentences) {
          if (sentence.trim()) {
            if (wsReadyRef.current && streamingTtsRef.current) {
              streamingTtsRef.current.sendText(sentence)
            } else {
              pendingSentencesRef.current.push(sentence)
            }
          }
        }
      })
      log.log('[useTTS] Bus stream subscription created')
    }

    if (!busStreamEndUnsubRef.current) {
      busStreamEndUnsubRef.current = bus.on('streamEnd', () => {
        log.log('[useTTS] Stream ended')
        const remainingText = sentenceBufferRef.current.trim()

        if (remainingText) {
          if (streamingTtsRef.current && wsReadyRef.current) {
            log.log('[useTTS] Flushing remaining text via WebSocket')
            streamingTtsRef.current.sendText(remainingText, true)
            sentenceBufferRef.current = ''
          } else {
            log.log('[useTTS] WebSocket not ready, remaining text will be handled by fallback')
          }
        }
      })
      log.log('[useTTS] Bus streamEnd subscription created')
    }

    return () => {
      if (busUnsubRef.current) {
        busUnsubRef.current()
        busUnsubRef.current = null
      }
      if (busStreamEndUnsubRef.current) {
        busStreamEndUnsubRef.current()
        busStreamEndUnsubRef.current = null
      }
    }
  }, [enabled, hubUrl, hubAccessToken])

  /**
   * Streaming TTS: Connect WebSocket when streaming starts
   */
  useEffect(() => {
    if (!enabled) {
      if (streamingTtsRef.current) {
        streamingTtsRef.current.destroy()
        streamingTtsRef.current = null
      }
      ttsService.stop()
      ttsCoordinator.stopAll()
      return
    }

    if (!hubUrl || !hubAccessToken) {
      return
    }

    if (status !== 'streaming') {
      return
    }

    let disconnectLipSync: (() => void) | null = null
    let connectionStarted = false

    const startStreamingConnection = async () => {
      if (connectionStarted || streamingTtsRef.current) return
      connectionStarted = true

      let currentVoiceId = 'MEJe6hPrI48Kt2lFuVe3'
      try {
        const companion = await getActiveCompanion(activeCompanionSlug)
        currentVoiceId = companion.personality.voice?.voiceId || 'MEJe6hPrI48Kt2lFuVe3'
      } catch {
        // Use default
      }

      ttsCoordinator.stopAll()

      streamingTtsRef.current = new StreamingTTSService(hubUrl, hubAccessToken, {
        enabled: true,
        voice: currentVoiceId,
        volume,
        speed: 1.0,
      })

      log.log('[useTTS] Connecting to streaming TTS...')
      const connected = await streamingTtsRef.current.connect()
      if (!connected) {
        log.warn('[useTTS] Streaming TTS connection failed, will fall back to non-streaming')
        streamingTtsFailedRef.current = true
        streamingTtsRef.current.destroy()
        streamingTtsRef.current = null
        return
      }

      log.log('[useTTS] Streaming TTS connected')

      ttsCoordinator.registerActive(() => {
        if (streamingTtsRef.current) {
          streamingTtsRef.current.destroy()
          streamingTtsRef.current = null
        }
      })

      wsReadyRef.current = true
      if (pendingSentencesRef.current.length > 0) {
        log.log(`[useTTS] Sending ${pendingSentencesRef.current.length} buffered sentences`)
        for (const sentence of pendingSentencesRef.current) {
          streamingTtsRef.current.sendText(sentence)
        }
        pendingSentencesRef.current = []
      }

      bus.emit('avatar', { type: 'speaking:start' })

      const analyser = streamingTtsRef.current.getAnalyserNode()
      if (analyser) {
        const connectLipSync = (window as { __yumiConnectStreamingAnalyser?: (a: AnalyserNode) => () => void }).__yumiConnectStreamingAnalyser
        if (connectLipSync) {
          disconnectLipSync = connectLipSync(analyser)
          log.log('[useTTS] Streaming lip sync connected')
        }
      }

      streamingTtsRef.current.onAudioEnd(() => {
        log.log('[useTTS] Streaming TTS audio finished')

        const hadAudio = streamingTtsRef.current?.hasReceivedAudio() ?? false
        if (!hadAudio) {
          log.warn('[useTTS] No audio was received, marking as failed for fallback')
          streamingTtsFailedRef.current = true
        }

        if (disconnectLipSync) {
          disconnectLipSync()
          disconnectLipSync = null
        }

        ttsCoordinator.clearActive()
        bus.emit('avatar', { type: 'speaking:stop' })

        if (streamingTtsRef.current) {
          streamingTtsRef.current.destroy()
          streamingTtsRef.current = null
        }
      })
    }

    startStreamingConnection()

    return () => {
      if (streamingTtsRef.current && sentenceBufferRef.current.trim()) {
        log.log('[useTTS] Flushing remaining text')
        streamingTtsRef.current.sendText(sentenceBufferRef.current, true)
        sentenceBufferRef.current = ''
      }

      if (streamingTtsRef.current) {
        streamingTtsRef.current.close()
      }

      if (disconnectLipSync) {
        disconnectLipSync()
      }
    }
  }, [status, enabled, hubUrl, hubAccessToken, volume, activeCompanionSlug])

  /**
   * Fallback when streaming ends
   */
  useEffect(() => {
    if (status !== 'idle' && status !== 'error' && status !== 'canceled') {
      return
    }

    const wasStreamingActive = isStreamingActiveRef.current
    wsReadyRef.current = false
    isStreamingActiveRef.current = false

    const hasUnsentText = fullTextBufferRef.current.trim().length > 0
    const streamingFailed = streamingTtsFailedRef.current
    const hadNoAudio = streamingTtsRef.current ? !streamingTtsRef.current.hasReceivedAudio() : true
    const hasPendingSentences = pendingSentencesRef.current.length > 0
    const hasRemainingBuffer = sentenceBufferRef.current.trim().length > 0

    const shouldFallback = wasStreamingActive && hasUnsentText && (
      streamingFailed ||
      hadNoAudio ||
      hasPendingSentences ||
      hasRemainingBuffer
    )

    if (shouldFallback) {
      log.log('[useTTS] Falling back to non-streaming TTS', {
        streamingFailed,
        hadNoAudio,
        hasPendingSentences,
        hasRemainingBuffer
      })
      const textToSpeak = fullTextBufferRef.current
      fullTextBufferRef.current = ''
      sentenceBufferRef.current = ''
      pendingSentencesRef.current = []
      bus.emit('avatar', { type: 'speaking:start' })
      ttsService.speak(textToSpeak)
        .then(() => bus.emit('avatar', { type: 'speaking:stop' }))
        .catch((err) => {
          log.error('[useTTS] Fallback TTS failed:', err)
          bus.emit('avatar', { type: 'speaking:stop' })
        })
    }
  }, [status])

  return {
    streamingTtsRef,
    streamingTtsFailedRef
  }
}
