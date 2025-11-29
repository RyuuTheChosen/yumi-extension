/**
 * TTS (Text-to-Speech) Type Definitions
 *
 * TTS streams through Hub API (ElevenLabs backend).
 */

export interface TTSSettings {
  enabled: boolean
  voice: string // ElevenLabs voice ID (from companion)
  volume: number // 0-1 volume level
  speed: number // 0.5-2.0 playback speed (1.0 = normal)
}

export const DEFAULT_TTS_SETTINGS: TTSSettings = {
  enabled: true,
  voice: 'MEJe6hPrI48Kt2lFuVe3', // Yumi custom voice
  volume: 1.0,
  speed: 1.0,
}

export interface TTSVoice {
  id: string
  name: string
  description: string
}

// Available voices (matches Hub API /v1/tts/voices)
export const TTS_VOICES: TTSVoice[] = [
  { id: 'MEJe6hPrI48Kt2lFuVe3', name: 'Yumi', description: 'Custom Yumi voice' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', description: 'Soft, young female' },
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', description: 'Warm, British female' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', description: 'Deep, British male' },
  { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', description: 'Intense, American male' },
]

export interface TTSPlaybackState {
  isPlaying: boolean
  isPaused: boolean
  currentText: string | null
}

// Events emitted by TTS service
export type TTSEvent =
  | { type: 'speaking:start'; text: string }
  | { type: 'speaking:end' }
  | { type: 'speaking:error'; error: string }

// Streaming TTS message types (extension -> Hub WebSocket)
export type StreamingTTSOutMessage =
  | { type: 'init'; voiceId: string; modelId?: string; speed?: number }
  | { type: 'text'; text: string; flush?: boolean }
  | { type: 'close' }

// Streaming TTS message types (Hub WebSocket -> extension)
export type StreamingTTSInMessage =
  | { type: 'ready' }
  | { type: 'audio'; audio: string } // base64 encoded
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'alignment'; alignment: unknown }

// Streaming TTS connection state
export type StreamingTTSState = 'disconnected' | 'connecting' | 'connected' | 'error'
