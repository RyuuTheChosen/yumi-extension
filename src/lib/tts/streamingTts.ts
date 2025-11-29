/**
 * Streaming TTS Service
 *
 * Connects to Hub WebSocket for real-time TTS streaming during chat.
 * Plays audio chunks as they arrive for low-latency speech.
 */

import type {
  TTSSettings,
  StreamingTTSOutMessage,
  StreamingTTSInMessage,
  StreamingTTSState,
} from './types'

type StateChangeCallback = (state: StreamingTTSState) => void
type AudioEndCallback = () => void

// Sentence boundary detection pattern
const SENTENCE_ENDINGS = /([.!?])\s+/g

/**
 * Extract complete sentences from a text buffer.
 * Returns sentences and remaining incomplete text.
 */
export function extractCompleteSentences(buffer: string): {
  sentences: string[]
  remaining: string
} {
  const sentences: string[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  // Reset regex state
  SENTENCE_ENDINGS.lastIndex = 0

  while ((match = SENTENCE_ENDINGS.exec(buffer)) !== null) {
    // Include the punctuation but not the trailing whitespace
    const sentence = buffer.slice(lastIndex, match.index + 1).trim()
    if (sentence) {
      sentences.push(sentence)
    }
    lastIndex = match.index + match[0].length
  }

  return {
    sentences,
    remaining: buffer.slice(lastIndex),
  }
}

export class StreamingTTSService {
  private ws: WebSocket | null = null
  private audioContext: AudioContext | null = null
  private audioQueue: ArrayBuffer[] = []
  private isPlaying = false
  private nextPlayTime = 0
  private state: StreamingTTSState = 'disconnected'
  private stateCallbacks: Set<StateChangeCallback> = new Set()
  private audioEndCallback: AudioEndCallback | null = null
  private analyserNode: AnalyserNode | null = null
  private gainNode: GainNode | null = null

  constructor(
    private hubUrl: string,
    private accessToken: string,
    private settings: TTSSettings
  ) {}

  /**
   * Get the current connection state.
   */
  getState(): StreamingTTSState {
    return this.state
  }

  /**
   * Subscribe to state changes.
   */
  onStateChange(callback: StateChangeCallback): () => void {
    this.stateCallbacks.add(callback)
    return () => this.stateCallbacks.delete(callback)
  }

  /**
   * Set callback for when all audio playback completes.
   */
  onAudioEnd(callback: AudioEndCallback): void {
    this.audioEndCallback = callback
  }

  /**
   * Get the analyser node for lip sync integration.
   */
  getAnalyserNode(): AnalyserNode | null {
    return this.analyserNode
  }

  /**
   * Connect to Hub TTS WebSocket.
   */
  async connect(): Promise<boolean> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return true
    }

    this.setState('connecting')

    // Initialize audio context
    if (!this.audioContext) {
      this.audioContext = new AudioContext()
      this.analyserNode = this.audioContext.createAnalyser()
      this.analyserNode.fftSize = 256
      this.gainNode = this.audioContext.createGain()
      this.gainNode.gain.value = this.settings.volume
      this.gainNode.connect(this.analyserNode)
      this.analyserNode.connect(this.audioContext.destination)
    }

    // Resume audio context if suspended (browser autoplay policy)
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume()
    }

    return new Promise((resolve) => {
      // Build WebSocket URL with auth token
      const wsProtocol = this.hubUrl.startsWith('https') ? 'wss' : 'ws'
      const baseUrl = this.hubUrl.replace(/^https?/, wsProtocol)
      const wsUrl = `${baseUrl}/v1/tts/ws?token=${encodeURIComponent(this.accessToken)}`

      this.ws = new WebSocket(wsUrl)

      this.ws.onopen = () => {
        console.log('[StreamingTTS] WebSocket connected')

        // Send init message
        const initMsg: StreamingTTSOutMessage = {
          type: 'init',
          voiceId: this.settings.voice,
          speed: this.settings.speed,
        }
        this.ws!.send(JSON.stringify(initMsg))
      }

      this.ws.onmessage = (event) => {
        try {
          const message: StreamingTTSInMessage = JSON.parse(event.data)
          this.handleMessage(message, resolve)
        } catch (err) {
          console.error('[StreamingTTS] Error parsing message:', err)
        }
      }

      this.ws.onerror = (event) => {
        console.error('[StreamingTTS] WebSocket error:', event)
        this.setState('error')
        resolve(false)
      }

      this.ws.onclose = () => {
        console.log('[StreamingTTS] WebSocket closed')
        this.setState('disconnected')
        this.ws = null
      }
    })
  }

  /**
   * Handle incoming WebSocket message.
   */
  private handleMessage(
    message: StreamingTTSInMessage,
    connectResolve?: (value: boolean) => void
  ): void {
    switch (message.type) {
      case 'ready':
        console.log('[StreamingTTS] Ready to stream')
        this.setState('connected')
        connectResolve?.(true)
        break

      case 'audio':
        this.handleAudioChunk(message.audio)
        break

      case 'done':
        console.log('[StreamingTTS] Audio stream complete')
        // Audio end will be signaled when queue is empty
        break

      case 'error':
        console.error('[StreamingTTS] Server error:', message.message)
        this.setState('error')
        break

      case 'alignment':
        // Could be used for word-level lip sync in future
        break
    }
  }

  /**
   * Handle incoming audio chunk.
   */
  private async handleAudioChunk(base64Audio: string): Promise<void> {
    try {
      // Decode base64 to ArrayBuffer
      const binaryString = atob(base64Audio)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      const audioData = bytes.buffer

      // Add to queue
      this.audioQueue.push(audioData)

      // Start playback if not already playing
      if (!this.isPlaying) {
        this.playNextChunk()
      }
    } catch (err) {
      console.error('[StreamingTTS] Error processing audio chunk:', err)
    }
  }

  /**
   * Play the next audio chunk from the queue.
   */
  private async playNextChunk(): Promise<void> {
    if (!this.audioContext || !this.gainNode) {
      return
    }

    if (this.audioQueue.length === 0) {
      this.isPlaying = false
      // Signal audio end if we're done
      if (this.state === 'connected') {
        this.audioEndCallback?.()
      }
      return
    }

    this.isPlaying = true
    const audioData = this.audioQueue.shift()!

    try {
      // Decode audio data
      const audioBuffer = await this.audioContext.decodeAudioData(audioData.slice(0))

      // Create source and connect to gain -> analyser -> destination
      const source = this.audioContext.createBufferSource()
      source.buffer = audioBuffer
      source.connect(this.gainNode)

      // Schedule playback for gapless audio
      const startTime = Math.max(this.audioContext.currentTime, this.nextPlayTime)
      source.start(startTime)
      this.nextPlayTime = startTime + audioBuffer.duration

      // Queue next chunk when this one ends
      source.onended = () => {
        this.playNextChunk()
      }
    } catch (err) {
      console.error('[StreamingTTS] Error playing audio chunk:', err)
      // Try next chunk
      this.playNextChunk()
    }
  }

  /**
   * Send text to TTS service.
   */
  sendText(text: string, flush = false): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[StreamingTTS] Cannot send text: not connected')
      return
    }

    if (!text.trim()) {
      return
    }

    const msg: StreamingTTSOutMessage = {
      type: 'text',
      text,
      flush,
    }
    this.ws.send(JSON.stringify(msg))
  }

  /**
   * Update volume.
   */
  setVolume(volume: number): void {
    this.settings.volume = volume
    if (this.gainNode) {
      this.gainNode.gain.value = volume
    }
  }

  /**
   * Close the WebSocket connection and cleanup.
   */
  close(): void {
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        const closeMsg: StreamingTTSOutMessage = { type: 'close' }
        this.ws.send(JSON.stringify(closeMsg))
      }
      this.ws.close()
      this.ws = null
    }

    // Clear audio queue but let current playback finish
    this.audioQueue = []
    this.setState('disconnected')
  }

  /**
   * Stop all playback and cleanup resources.
   */
  destroy(): void {
    this.close()

    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }

    this.analyserNode = null
    this.gainNode = null
    this.stateCallbacks.clear()
    this.audioEndCallback = null
  }

  /**
   * Set state and notify listeners.
   */
  private setState(state: StreamingTTSState): void {
    this.state = state
    for (const callback of this.stateCallbacks) {
      try {
        callback(state)
      } catch (err) {
        console.error('[StreamingTTS] State callback error:', err)
      }
    }
  }
}
