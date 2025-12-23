/**
 * Avatar State Manager
 *
 * Tracks avatar state (speaking/thinking/idle) to coordinate multiple event sources.
 * Uses reference counting for concurrent sources (e.g., chat TTS + proactive TTS).
 *
 * NOTE: This module only tracks STATE. Animation and expression control is handled
 * by the event bridge in overlayVrm.ts which forwards events to EchoAvatar's
 * AnimationTriggerService.
 */

import { createLogger } from '../lib/core/debug'

const log = createLogger('AvatarState')

type AvatarState = 'idle' | 'thinking' | 'speaking'

/** Current avatar state */
let currentState: AvatarState = 'idle'

/** Track concurrent speaking sources (e.g., chat TTS + proactive TTS) */
let speakingCount = 0

/** Track concurrent thinking sources */
let thinkingCount = 0

/**
 * Set the avatar to speaking state.
 * Call with active=true when speaking starts, active=false when it ends.
 * Speaking has highest priority.
 *
 * NOTE: Animations and expressions are triggered by the event bridge, not here.
 */
export function setAvatarSpeaking(active: boolean): void {
  log.log(`setAvatarSpeaking(${active}), count was ${speakingCount}`)

  if (active) {
    speakingCount++
    if (currentState !== 'speaking') {
      currentState = 'speaking'
    }
  } else {
    speakingCount = Math.max(0, speakingCount - 1)
    if (speakingCount === 0) {
      currentState = thinkingCount > 0 ? 'thinking' : 'idle'
    }
  }
}

/**
 * Set the avatar to thinking state.
 * Call with active=true when thinking starts, active=false when it ends.
 * Thinking is lower priority than speaking.
 *
 * NOTE: Animations and expressions are triggered by the event bridge, not here.
 */
export function setAvatarThinking(active: boolean): void {
  log.log(`setAvatarThinking(${active}), count was ${thinkingCount}`)

  if (active) {
    thinkingCount++
    if (currentState === 'idle') {
      currentState = 'thinking'
    }
  } else {
    thinkingCount = Math.max(0, thinkingCount - 1)
    if (thinkingCount === 0 && currentState === 'thinking') {
      currentState = 'idle'
    }
  }
}

/**
 * Get current avatar state (for debugging and coordination)
 */
export function getAvatarState(): { state: AvatarState; speakingCount: number; thinkingCount: number } {
  return {
    state: currentState,
    speakingCount,
    thinkingCount,
  }
}

/**
 * Check if currently speaking
 */
export function isSpeaking(): boolean {
  return speakingCount > 0
}

/**
 * Check if currently thinking
 */
export function isThinking(): boolean {
  return thinkingCount > 0
}

/**
 * Reset all avatar state (for cleanup)
 */
export function resetAvatarState(): void {
  currentState = 'idle'
  speakingCount = 0
  thinkingCount = 0
}
