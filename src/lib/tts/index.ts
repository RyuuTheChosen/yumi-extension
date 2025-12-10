/**
 * TTS Module Exports
 *
 * TTS streams through Hub API (which proxies to ElevenLabs).
 * No client-side API key needed.
 */

export * from './types'
export { ttsService, TTSService, refreshAccessToken } from './ttsService'
export { StreamingTTSService, extractCompleteSentences } from './streamingTts'
export { ttsCoordinator } from './ttsCoordinator'
