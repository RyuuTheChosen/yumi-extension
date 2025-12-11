/**
 * Avatar State Manager
 *
 * Centralizes avatar expression control to prevent conflicts from multiple event sources.
 * Uses a priority system: speaking > thinking > idle
 *
 * This solves the problem where useTTS, useProactiveMemory, and other sources
 * emit avatar events simultaneously, causing expression glitches.
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

/** Timer for resetting to idle after speaking/thinking stops */
let resetTimer: number | null = null

/** Delay before resetting to idle (ms) */
const RESET_DELAY_MS = 500

/**
 * Apply an expression to the avatar model
 */
function applyExpression(name: string): void {
  const expr = (window as { __yumiExpression?: { set: (name: string) => void } }).__yumiExpression
  if (expr) {
    log.log(`Setting expression: ${name}`)
    expr.set(name)
  }
}

/**
 * Clear the reset timer if active
 */
function clearResetTimer(): void {
  if (resetTimer !== null) {
    clearTimeout(resetTimer)
    resetTimer = null
  }
}

/**
 * Schedule a reset to idle state if no other activity
 */
function maybeReturnToIdle(): void {
  if (speakingCount > 0 || thinkingCount > 0) {
    return
  }

  clearResetTimer()
  resetTimer = window.setTimeout(() => {
    currentState = 'idle'
    applyExpression('neutral')
    resetTimer = null
  }, RESET_DELAY_MS)
}

/**
 * Set the avatar to speaking state.
 * Call with active=true when speaking starts, active=false when it ends.
 * Speaking has highest priority.
 */
export function setAvatarSpeaking(active: boolean): void {
  log.log(`setAvatarSpeaking(${active}), count was ${speakingCount}`)

  if (active) {
    speakingCount++
    clearResetTimer()
    if (currentState !== 'speaking') {
      currentState = 'speaking'
      applyExpression('happy')
    }
  } else {
    speakingCount = Math.max(0, speakingCount - 1)
    if (speakingCount === 0) {
      maybeReturnToIdle()
    }
  }
}

/**
 * Set the avatar to thinking state.
 * Call with active=true when thinking starts, active=false when it ends.
 * Thinking is lower priority than speaking.
 */
export function setAvatarThinking(active: boolean): void {
  log.log(`setAvatarThinking(${active}), count was ${thinkingCount}`)

  if (active) {
    thinkingCount++
    clearResetTimer()
    /** Only set thinking expression if not currently speaking */
    if (currentState === 'idle') {
      currentState = 'thinking'
      applyExpression('thinking')
    }
  } else {
    thinkingCount = Math.max(0, thinkingCount - 1)
    if (thinkingCount === 0 && currentState === 'thinking') {
      maybeReturnToIdle()
    }
  }
}

/**
 * Get current avatar state (for debugging)
 */
export function getAvatarState(): { state: AvatarState; speakingCount: number; thinkingCount: number } {
  return {
    state: currentState,
    speakingCount,
    thinkingCount,
  }
}

/**
 * Reset all avatar state (for cleanup)
 */
export function resetAvatarState(): void {
  clearResetTimer()
  currentState = 'idle'
  speakingCount = 0
  thinkingCount = 0
  applyExpression('neutral')
}
