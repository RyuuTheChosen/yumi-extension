/**
 * TTS Coordinator
 *
 * Manages coordination between streaming and non-streaming TTS systems
 * to prevent overlapping audio playback. Only one TTS can be active at a time.
 */

import { createLogger } from '../core/debug'

const log = createLogger('TTSCoordinator')

type StopCallback = () => void

class TTSCoordinator {
  private activeStopCallback: StopCallback | null = null

  /**
   * Register active TTS playback.
   * Stops any currently playing TTS before registering the new one.
   */
  registerActive(stopCallback: StopCallback): void {
    this.stopAll()
    this.activeStopCallback = stopCallback
    log.log('Registered active TTS')
  }

  /**
   * Clear registration when TTS completes naturally.
   */
  clearActive(): void {
    this.activeStopCallback = null
    log.log('Cleared active TTS')
  }

  /**
   * Stop all active TTS playback.
   */
  stopAll(): void {
    if (this.activeStopCallback) {
      log.log('Stopping active TTS')
      this.activeStopCallback()
      this.activeStopCallback = null
    }
  }
}

export const ttsCoordinator = new TTSCoordinator()
