import type { STTSettings, STTEvent, STTState } from './types'
import { DEFAULT_STT_SETTINGS } from './types'
import { createLogger } from '../core/debug'

const log = createLogger('STT')

type STTEventCallback = (event: STTEvent) => void

const MAX_RECORDING_DURATION = 60000
const MIN_RECORDING_DURATION = 800

class STTService {
  private settings: STTSettings = DEFAULT_STT_SETTINGS
  private eventListeners: Set<STTEventCallback> = new Set()
  private mediaRecorder: MediaRecorder | null = null
  private audioChunks: Blob[] = []
  private mediaStream: MediaStream | null = null
  private state: STTState = 'idle'
  private hubUrl: string = ''
  private hubAccessToken: string = ''
  private lastCredentials: string = ''
  private recordingTimeout: ReturnType<typeof setTimeout> | null = null
  private recordingStartTime: number = 0

  initialize(hubUrl: string, hubAccessToken: string, settings?: Partial<STTSettings>): void {
    const creds = `${hubUrl}:${hubAccessToken}`
    if (this.lastCredentials === creds && this.settings.enabled === settings?.enabled) {
      return
    }

    this.hubUrl = hubUrl
    this.hubAccessToken = hubAccessToken
    this.lastCredentials = creds

    if (settings) {
      this.settings = { ...this.settings, ...settings }
    }

    log.log('Initialized with Hub API')
  }

  updateSettings(settings: Partial<STTSettings>): void {
    this.settings = { ...this.settings, ...settings }
  }

  updateCredentials(hubUrl: string, hubAccessToken: string): void {
    this.hubUrl = hubUrl
    this.hubAccessToken = hubAccessToken
    this.lastCredentials = `${hubUrl}:${hubAccessToken}`
  }

  getState(): STTState {
    return this.state
  }

  getRecordingDuration(): number {
    if (this.state !== 'recording' || !this.recordingStartTime) return 0
    return Date.now() - this.recordingStartTime
  }

  async startRecording(): Promise<boolean> {
    if (!this.settings.enabled) {
      return false
    }

    if (this.state !== 'idle') {
      log.warn('Already recording or transcribing')
      return false
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = this.getSupportedMimeType()

      this.mediaRecorder = new MediaRecorder(this.mediaStream, { mimeType })
      this.audioChunks = []

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data)
        }
      }

      this.mediaRecorder.start()
      this.state = 'recording'
      this.recordingStartTime = Date.now()
      this.emit({ type: 'recording:start' })

      this.recordingTimeout = setTimeout(() => {
        if (this.state === 'recording') {
          this.stopRecordingAndTranscribe()
        }
      }, MAX_RECORDING_DURATION)

      log.log('Recording started')
      return true
    } catch (err) {
      log.error('Failed to start recording:', err)
      const errorMessage = this.getPermissionErrorMessage(err)
      this.emit({ type: 'transcription:error', error: errorMessage })
      this.state = 'idle'
      return false
    }
  }

  async stopRecordingAndTranscribe(): Promise<string | null> {
    if (this.state !== 'recording' || !this.mediaRecorder) {
      return null
    }

    this.clearRecordingTimeout()
    const recordingDuration = Date.now() - this.recordingStartTime

    return new Promise((resolve) => {
      this.mediaRecorder!.onstop = async () => {
        this.emit({ type: 'recording:stop' })
        this.state = 'transcribing'
        this.emit({ type: 'transcription:start' })

        this.stopMediaStream()

        const mimeType = this.mediaRecorder?.mimeType || 'audio/webm'
        this.mediaRecorder = null

        const audioBlob = new Blob(this.audioChunks, { type: mimeType })
        this.audioChunks = []

        log.log(`Recorded ${audioBlob.size} bytes in ${recordingDuration}ms`)

        if (recordingDuration < MIN_RECORDING_DURATION || audioBlob.size < 1000) {
          this.emit({ type: 'transcription:error', error: 'Hold longer to record' })
          this.state = 'idle'
          resolve(null)
          return
        }

        try {
          const text = await this.transcribe(audioBlob)
          this.emit({ type: 'transcription:complete', text })
          this.state = 'idle'
          resolve(text)
        } catch (err) {
          log.error('Transcription failed:', err)
          this.emit({ type: 'transcription:error', error: (err as Error).message })
          this.state = 'idle'
          resolve(null)
        }
      }

      this.mediaRecorder!.stop()
    })
  }

  cancelRecording(): void {
    this.clearRecordingTimeout()

    if (this.mediaRecorder && this.state === 'recording') {
      this.mediaRecorder.stop()
      this.stopMediaStream()
      this.mediaRecorder = null
      this.audioChunks = []
      this.state = 'idle'
      this.recordingStartTime = 0
      this.emit({ type: 'recording:stop' })
      log.log('Recording cancelled')
    }
  }

  on(callback: STTEventCallback): () => void {
    this.eventListeners.add(callback)
    return () => this.eventListeners.delete(callback)
  }

  private emit(event: STTEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event)
      } catch (e) {
        log.error('Event listener error:', e)
      }
    }
  }

  private clearRecordingTimeout(): void {
    if (this.recordingTimeout) {
      clearTimeout(this.recordingTimeout)
      this.recordingTimeout = null
    }
  }

  private async transcribe(audioBlob: Blob): Promise<string> {
    if (!this.hubUrl || !this.hubAccessToken) {
      throw new Error('Hub credentials not configured')
    }

    const formData = new FormData()
    formData.append('audio', audioBlob, 'recording.webm')

    let response: Response
    try {
      response = await fetch(`${this.hubUrl}/v1/stt`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.hubAccessToken}`,
        },
        body: formData,
      })
    } catch {
      throw new Error('Network error. Check connection.')
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Session expired. Please reconnect.')
      }
      if (response.status === 429) {
        throw new Error('Monthly limit reached')
      }
      if (response.status >= 500) {
        throw new Error('Service temporarily unavailable. Try again.')
      }

      const error = await response.json().catch(() => ({ error: 'Transcription failed' }))
      throw new Error(error.error || 'Transcription failed')
    }

    const result = await response.json() as { text: string }
    return result.text || ''
  }

  private getSupportedMimeType(): string {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ]

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type
      }
    }

    return 'audio/webm'
  }

  private stopMediaStream(): void {
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop()
      }
      this.mediaStream = null
    }
  }

  private getPermissionErrorMessage(err: unknown): string {
    if (!(err instanceof Error)) {
      return 'Failed to access microphone.'
    }

    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      return 'Microphone access denied. Check browser settings.'
    }

    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      return 'No microphone found.'
    }

    if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      return 'Microphone is in use by another app.'
    }

    return 'Failed to access microphone.'
  }

  destroy(): void {
    this.cancelRecording()
    this.eventListeners.clear()
  }
}

export const sttService = new STTService()
export { STTService }
