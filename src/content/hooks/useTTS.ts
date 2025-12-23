/**
 * Text-to-Speech Hook
 *
 * Handles both non-streaming TTS initialization and real-time streaming TTS.
 * Manages WebSocket connection, sentence boundary detection, and lip sync integration.
 */

import { useEffect, useRef, useState } from 'react'
import { createLogger } from '../../lib/core/debug'
import { ttsService, ttsCoordinator, refreshAccessToken } from '../../lib/tts'
import { StreamingTTSService, extractCompleteSentences } from '../../lib/tts/streamingTts'
import { bus } from '../../lib/core/bus'
import { getActiveCompanion } from '../../lib/companions/loader'
import { useSettingsStore } from '../../lib/stores/settings.store'
import { isPluginActive } from '../../lib/plugins/loader'

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
  const prevStatusForThinkingRef = useRef(status)

  statusRef.current = status

  /**
   * Track TTS plugin ready state - reactive to plugins:loaded event
   */
  const [ttsPluginReady, setTtsPluginReady] = useState(() => isPluginActive('tts'))

  /**
   * Subscribe to plugin loading to handle race condition where
   * ChatOverlay mounts before plugins are loaded.
   * Always register listener for future plugin reloads (companion changes).
   */
  useEffect(() => {
    /** Check synchronously - plugins may have loaded between render and effect */
    if (isPluginActive('tts')) {
      setTtsPluginReady(true)
    }

    /** Always register listener for plugin changes (companion switches may reload plugins) */
    const unsub = bus.on('plugins:loaded', (plugins) => {
      const isActive = plugins.includes('tts')
      log.log('Plugin loaded event, tts active:', isActive)
      setTtsPluginReady(isActive)
    })
    return unsub
  }, [])

  /**
   * Emit avatar thinking events based on chat status changes.
   * This is independent of TTS plugin status - expressions should work
   * even when TTS is disabled.
   */
  useEffect(() => {
    const prevStatus = prevStatusForThinkingRef.current
    prevStatusForThinkingRef.current = status

    log.log('Status change:', prevStatus, '->', status)

    /** Trigger thinking:start when streaming begins (from idle or sending) */
    if ((prevStatus === 'idle' || prevStatus === 'sending') && status === 'streaming') {
      log.log('Emitting thinking:start')
      bus.emit('avatar', { type: 'thinking:start' })
    }

    /** Trigger thinking:stop when streaming ends */
    if (prevStatus === 'streaming' && status === 'idle') {
      log.log('Emitting thinking:stop')
      bus.emit('avatar', { type: 'thinking:stop' })
    }
  }, [status])

  /**
   * Initialize non-streaming TTS service with Hub credentials and companion voice
   */
  useEffect(() => {
    log.log('Init check:', { enabled, ttsPluginReady, hubUrl: !!hubUrl })

    if (!enabled || !ttsPluginReady) {
      log.log('TTS disabled or plugin not ready')
      return
    }

    if (!hubUrl || !hubAccessToken) {
      log.log('TTS enabled but not logged in to Hub')
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
        log.log('TTS initialized with companion voice:', voiceId)
      } catch (err) {
        log.error('[useTTS] Failed to load companion for TTS:', err)
      }
    }

    initTTS()
  }, [enabled, ttsPluginReady, volume, activeCompanionSlug, hubUrl, hubAccessToken])

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
        log.log('Stream ended event')
        const remainingText = sentenceBufferRef.current.trim()

        if (remainingText) {
          if (streamingTtsRef.current && wsReadyRef.current) {
            log.log('Flushing remaining text via WebSocket')
            streamingTtsRef.current.sendText(remainingText, true)
            sentenceBufferRef.current = ''
            /** Close after flushing - only if WebSocket was ready */
            log.log('Closing WebSocket after flush')
            streamingTtsRef.current.close()
          } else {
            log.log('WebSocket not ready, remaining text will be handled by fallback')
            /** DON'T close here - let the fallback handle it or wait for WS to connect */
          }
        } else if (streamingTtsRef.current && wsReadyRef.current) {
          /** No remaining text but WebSocket is ready - close it */
          log.log('No remaining text, closing WebSocket')
          streamingTtsRef.current.close()
        }
        /** If WebSocket not ready and no remaining text, don't close - let it naturally complete */
      })
      log.log('Bus streamEnd subscription created')
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
        /** Use default */
      }

      ttsCoordinator.stopAll()

      /** Get current token from store (may be fresher than hook prop) */
      let currentToken = useSettingsStore.getState().hubAccessToken || hubAccessToken

      streamingTtsRef.current = new StreamingTTSService(hubUrl, currentToken, {
        enabled: true,
        voice: currentVoiceId,
        volume,
        speed: 1.0,
      })

      log.log('Connecting to streaming TTS...')
      let connected = await streamingTtsRef.current.connect()

      /** If connection failed, try refreshing token and retry once */
      if (!connected) {
        log.log('Connection failed, attempting token refresh...')
        const newToken = await refreshAccessToken()
        if (newToken) {
          streamingTtsRef.current.destroy()
          streamingTtsRef.current = new StreamingTTSService(hubUrl, newToken, {
            enabled: true,
            voice: currentVoiceId,
            volume,
            speed: 1.0,
          })
          connected = await streamingTtsRef.current.connect()
        }
      }

      if (!connected) {
        log.warn('Streaming TTS connection failed, will fall back to non-streaming')
        streamingTtsFailedRef.current = true
        streamingTtsRef.current.destroy()
        streamingTtsRef.current = null
        return
      }

      log.log('Streaming TTS connected')

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
      log.log('Got analyser node:', !!analyser)
      if (analyser) {
        const connectLipSync = (window as { __yumiConnectStreamingAnalyser?: (a: AnalyserNode) => () => void }).__yumiConnectStreamingAnalyser
        log.log('connectLipSync function available:', !!connectLipSync)
        if (connectLipSync) {
          disconnectLipSync = connectLipSync(analyser)
          log.log('Streaming lip sync connected')
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
      /**
       * When status changes from streaming -> idle, we DON'T want to close
       * the WebSocket immediately. The audio is still playing!
       *
       * Instead, flush any remaining text and let onAudioEnd handle cleanup.
       * Only close if we're disabling TTS entirely or unmounting.
       */
      if (streamingTtsRef.current && sentenceBufferRef.current.trim()) {
        log.log('Cleanup: Flushing remaining text')
        streamingTtsRef.current.sendText(sentenceBufferRef.current, true)
        sentenceBufferRef.current = ''
      }

      /**
       * Only close WebSocket if TTS is being disabled or we're unmounting.
       * Check statusRef to see current status - if idle, audio should keep playing.
       */
      if (streamingTtsRef.current && statusRef.current !== 'idle') {
        log.log('Cleanup: Closing WebSocket (status:', statusRef.current, ')')
        streamingTtsRef.current.close()
      }

      /** disconnectLipSync is handled in onAudioEnd callback */
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

    log.log('Fallback check:', {
      wasStreamingActive,
      hasUnsentText,
      streamingFailed,
      hadNoAudio,
      hasPendingSentences,
      hasRemainingBuffer,
      shouldFallback
    })

    if (shouldFallback) {
      log.log('Falling back to non-streaming TTS')
      const textToSpeak = fullTextBufferRef.current
      fullTextBufferRef.current = ''
      sentenceBufferRef.current = ''
      pendingSentencesRef.current = []
      bus.emit('avatar', { type: 'speaking:start' })
      ttsService.speak(textToSpeak)
        .then(() => {
          log.log('Fallback TTS completed')
          bus.emit('avatar', { type: 'speaking:stop' })
        })
        .catch((err) => {
          log.error('Fallback TTS failed:', err)
          bus.emit('avatar', { type: 'speaking:stop' })
        })
    }
  }, [status])

  return {
    streamingTtsRef,
    streamingTtsFailedRef
  }
}
