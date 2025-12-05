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
import { createLogger } from '../debug'

const log = createLogger('StreamingTTS')

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
  private static readonly MAX_QUEUE_SIZE = 10
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
  private streamDone = false // Track if server sent 'done' message

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
    this.streamDone = false

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
        log.log('WebSocket connected')

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
          log.error('Error parsing message:', err)
        }
      }

      this.ws.onerror = (event) => {
        log.error('WebSocket error:', event)
        this.setState('error')
        resolve(false)
      }

      this.ws.onclose = () => {
        log.log('WebSocket closed')
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
        log.log('Ready to stream')
        this.setState('connected')
        connectResolve?.(true)
        break

      case 'audio':
        log.log('Received audio chunk')
        this.handleAudioChunk(message.audio)
        break

      case 'done':
        log.log('Server signaled stream complete')
        this.streamDone = true
        // If queue is already empty, signal audio end now
        if (!this.isPlaying && this.audioQueue.length === 0) {
          this.audioEndCallback?.()
        }
        break

      case 'error':
        log.error('Server error:', message.message)
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

      // Enforce queue size limit to prevent memory buildup
      if (this.audioQueue.length >= StreamingTTSService.MAX_QUEUE_SIZE) {
        log.warn('Audio queue full, dropping oldest chunk')
        this.audioQueue.shift()
      }

      // Add to queue
      this.audioQueue.push(audioData)

      // Start playback if not already playing
      if (!this.isPlaying) {
        this.playNextChunk()
      }
    } catch (err) {
      log.error('Error processing audio chunk:', err)
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
      // Only signal audio end if stream is done (server sent 'done' or close() was called)
      if (this.streamDone) {
        this.setState('disconnected')
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
      log.error('Error playing audio chunk:', err)
      // Try next chunk
      this.playNextChunk()
    }
  }

  /**
   * Send text to TTS service.
   */
  sendText(text: string, flush = false): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.warn('Cannot send text: not connected')
      return
    }

    if (!text.trim()) {
      return
    }

    log.log(`Sending: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"${flush ? ' (flush)' : ''}`)

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
   * Close the WebSocket connection gracefully.
   * Audio queue is preserved to let pending audio finish playing.
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

    // Mark stream as done so audioEndCallback fires when queue empties
    this.streamDone = true

    // Don't clear audio queue - let pending audio finish playing
    // If nothing is playing but queue has items, start playback
    if (!this.isPlaying && this.audioQueue.length > 0) {
      this.playNextChunk()
    }

    // If already done playing, signal now
    if (!this.isPlaying && this.audioQueue.length === 0) {
      this.setState('disconnected')
      this.audioEndCallback?.()
    }
  }

  /**
   * Stop all playback immediately and cleanup all resources.
   */
  destroy(): void {
    // Close WebSocket without waiting for audio
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    // Clear audio queue to stop playback
    this.audioQueue = []
    this.isPlaying = false
    this.streamDone = true

    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }

    this.analyserNode = null
    this.gainNode = null
    this.setState('disconnected')
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
        log.error('State callback error:', err)
      }
    }
  }
}
