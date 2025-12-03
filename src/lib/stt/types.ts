export interface STTSettings {
  enabled: boolean
}

export const DEFAULT_STT_SETTINGS: STTSettings = {
  enabled: false,
}

export type STTState = 'idle' | 'recording' | 'transcribing' | 'error'

export type STTEvent =
  | { type: 'recording:start' }
  | { type: 'recording:stop' }
  | { type: 'transcription:start' }
  | { type: 'transcription:complete'; text: string }
  | { type: 'transcription:error'; error: string }
