/**
 * TTS Service
 *
 * Streams TTS audio from Hub API (which proxies to ElevenLabs).
 */

import type { TTSSettings, TTSEvent, TTSPlaybackState } from './types'
import { DEFAULT_TTS_SETTINGS } from './types'
import { createLogger } from '../core/debug'

const log = createLogger('TTS')

type TTSEventCallback = (event: TTSEvent) => void

class TTSService {
  private settings: TTSSettings = DEFAULT_TTS_SETTINGS
  private eventListeners: Set<TTSEventCallback> = new Set()
  private audioElement: HTMLAudioElement | null = null
  private currentBlobUrl: string | null = null
  private abortController: AbortController | null = null
  private hubUrl: string = ''
  private hubAccessToken: string = ''

  /**
   * Initialize the TTS service with Hub credentials.
   */
  initialize(hubUrl: string, hubAccessToken: string, settings?: Partial<TTSSettings>): void {
    this.hubUrl = hubUrl
    this.hubAccessToken = hubAccessToken

    if (settings) {
      this.settings = { ...this.settings, ...settings }
    }

    log.log('Initialized with Hub API')
  }

  /**
   * Update TTS settings at runtime.
   */
  updateSettings(settings: Partial<TTSSettings>): void {
    this.settings = { ...this.settings, ...settings }
    log.log('Settings updated:', this.settings)
  }

  /**
   * Update Hub credentials.
   */
  updateCredentials(hubUrl: string, hubAccessToken: string): void {
    this.hubUrl = hubUrl
    this.hubAccessToken = hubAccessToken
  }

  /**
   * Get current playback state.
   */
  getState(): TTSPlaybackState {
    return {
      isPlaying: this.audioElement ? !this.audioElement.paused : false,
      isPaused: this.audioElement?.paused ?? false,
      currentText: null,
    }
  }

  /**
   * Speak text using Hub TTS streaming.
   */
  async speak(text: string): Promise<void> {
    if (!this.settings.enabled) {
      log.log('Disabled, skipping speech')
      return
    }

    if (!text.trim()) {
      return
    }

    if (!this.hubUrl || !this.hubAccessToken) {
      log.warn('Hub credentials not set')
      return
    }

    // Stop any current playback
    this.stop()

    log.log('Requesting speech from Hub...')
    this.emit({ type: 'speaking:start', text })

    try {
      this.abortController = new AbortController()

      const response = await fetch(`${this.hubUrl}/v1/tts/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.hubAccessToken}`,
        },
        body: JSON.stringify({
          text,
          voiceId: this.settings.voice,
          speed: this.settings.speed,
        }),
        signal: this.abortController.signal,
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'TTS request failed' }))
        throw new Error(error.error || `TTS failed: ${response.status}`)
      }

      // Get audio as blob
      const audioBlob = await response.blob()
      await this.playAudioBlob(audioBlob, text)
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        log.log('Request aborted')
        return
      }
      log.error('Error:', err)
      this.emit({ type: 'speaking:error', error: (err as Error).message })
    }
  }

  /**
   * Play an audio blob with lip sync integration.
   */
  private async playAudioBlob(blob: Blob, text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Cleanup previous audio
      this.cleanupAudio()

      // Create blob URL
      this.currentBlobUrl = URL.createObjectURL(blob)

      // Create audio element
      this.audioElement = new Audio()
      this.audioElement.crossOrigin = 'anonymous'
      this.audioElement.volume = this.settings.volume
      this.audioElement.src = this.currentBlobUrl

      // Handle audio end
      const onEnded = () => {
        this.emit({ type: 'speaking:end' })
        this.cleanupAudio()
        resolve()
      }

      // Handle audio error
      const onError = (e: Event) => {
        const error = (e.target as HTMLAudioElement).error
        this.emit({
          type: 'speaking:error',
          error: error?.message ?? 'Audio playback failed',
        })
        this.cleanupAudio()
        reject(new Error(error?.message ?? 'Audio playback failed'))
      }

      this.audioElement.addEventListener('ended', onEnded, { once: true })
      this.audioElement.addEventListener('error', onError, { once: true })

      // Try to integrate with lip sync if available
      const connectAndPlay = (window as any).__yumiConnectAndPlayAudio
      if (connectAndPlay && typeof connectAndPlay === 'function') {
        connectAndPlay(this.audioElement, this.settings.voice)
          .catch((err: Error) => {
            log.error('Lip sync connection failed:', err)
            this.audioElement?.play()
          })
      } else {
        this.audioElement.play().catch(reject)
      }
    })
  }

  /**
   * Stop current speech.
   */
  stop(): void {
    // Abort any pending request
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }

    this.cleanupAudio()
    this.emit({ type: 'speaking:end' })
    log.log('Stopped')
  }

  /**
   * Cleanup audio resources.
   */
  private cleanupAudio(): void {
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl)
      this.currentBlobUrl = null
    }
    if (this.audioElement) {
      this.audioElement.pause()
      this.audioElement.src = ''
      this.audioElement = null
    }
  }

  /**
   * Subscribe to TTS events.
   */
  on(callback: TTSEventCallback): () => void {
    this.eventListeners.add(callback)
    return () => this.eventListeners.delete(callback)
  }

  /**
   * Emit event to all listeners.
   */
  private emit(event: TTSEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event)
      } catch (e) {
        log.error('Event listener error:', e)
      }
    }
  }

  /**
   * Destroy the service and cleanup resources.
   */
  destroy(): void {
    this.stop()
    this.eventListeners.clear()
    log.log('Service destroyed')
  }
}

// Export singleton instance
export const ttsService = new TTSService()

// Export class for testing
export { TTSService }
