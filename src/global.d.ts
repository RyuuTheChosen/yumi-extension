/**
 * Global type declarations for Yumi extension
 * Extends Window interface with Yumi-specific APIs
 */

import type { EchoAvatar, AnimationRegistry } from '@anthropic/echo-avatar'

/** Animation playback API exposed on window */
interface YumiAnimationAPI {
  trigger: (trigger: string) => void
  play: (animationId: string) => boolean
  getRegistry: () => AnimationRegistry | undefined
}

/** Expression control API */
interface YumiExpressionAPI {
  set: (name: string) => Promise<void>
  get: () => string | null
  list: () => string[]
}

/** Touch/interaction API */
interface YumiTouchAPI {
  setEnabled: (enabled: boolean) => void
  isEnabled: () => boolean
  clearCooldowns: () => void
}

/** Thinking state API */
interface YumiThinkingAPI {
  start: () => void
  stop: () => void
  isThinking: () => boolean
}

/** Emotion control API */
interface YumiEmotionAPI {
  set: (emotion: string, intensity?: number, duration?: number) => void
  nudge: (emotion: string, delta: number) => void
  get: () => string
  getIntensity: () => number
  recordInteraction: () => void
  getIdleTime: () => number
}

/** TTS audio connection function */
type YumiConnectAndPlayAudio = (audio: HTMLAudioElement, voiceId: string) => Promise<void>

/** Streaming analyser connection function */
type YumiConnectStreamingAnalyser = (analyser: AnalyserNode) => () => void

declare global {
  interface Window {
    /** Animation playback API */
    __yumiAnimation?: YumiAnimationAPI

    /** Echo Avatar instance */
    __echoAvatar?: EchoAvatar

    /** Expression control API */
    __yumiExpression?: YumiExpressionAPI

    /** Touch/interaction API */
    __yumiTouch?: YumiTouchAPI

    /** Thinking state API */
    __yumiThinking?: YumiThinkingAPI

    /** Emotion control API */
    __yumiEmotion?: YumiEmotionAPI

    /** TTS audio connection function */
    __yumiConnectAndPlayAudio?: YumiConnectAndPlayAudio

    /** Streaming analyser connection function */
    __yumiConnectStreamingAnalyser?: YumiConnectStreamingAnalyser

    /** Personality store reset function (debug) */
    resetYumiPersonality?: () => void
  }
}

export {}
