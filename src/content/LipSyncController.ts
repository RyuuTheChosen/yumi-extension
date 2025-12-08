/**
 * LipSyncController - Production-grade lip sync for Live2D avatars
 * 
 * Features:
 * - RMS to dB conversion for perceptual accuracy
 * - Noise gate with hysteresis (prevents chatter)
 * - Attack/decay envelope (natural speech feel)
 * - Per-voice calibration presets
 * - Graceful start/stop transitions
 * - Auto-calibration on first 300ms of speech
 * 
 * Architecture:
 * Audio → AudioContext → MediaElementSource → AnalyserNode → LipSyncController
 *                                                      ↓
 *                                        PIXI Ticker (40 FPS) → ParamMouthOpenY
 * 
 * @module LipSyncController
 * @author Yumi Team
 * @date November 13, 2025
 */

import { createLogger } from '../lib/core/debug'

const log = createLogger('LipSync')

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Voice-specific calibration preset.
 * Stores optimized parameters for different voices.
 */
export interface VoicePreset {
  /** Noise gate threshold in dB */
  gateDb: number
  /** Typical speaking level in dB */
  openDb: number
  /** Maximum mouth opening (0-1) */
  maxOpen: number
  /** Measured peak level during calibration */
  peakDb: number
  /** Measured average level during calibration */
  avgDb: number
}

/**
 * Real-time telemetry data for debugging and tuning.
 */
export interface LipSyncTelemetry {
  /** Current audio loudness in dB */
  currentDb: number
  /** Current envelope value (0-1) */
  envelope: number
  /** Whether noise gate is currently open */
  gateOpen: boolean
  /** Whether currently in speaking mode */
  speaking: boolean
  /** Whether auto-calibration is in progress */
  calibrating: boolean
  /** Current voice ID */
  currentVoice: string
  /** Current gate threshold in dB */
  gateDb: number
  /** Current speaking level in dB */
  openDb: number
}

// ============================================================================
// LipSyncController Class
// ============================================================================

/**
 * Production-grade lip sync controller with dB-based envelope processing.
 * 
 * Usage:
 * ```typescript
 * const ctx = new AudioContext()
 * const controller = new LipSyncController(ctx)
 * 
 * // Connect audio source
 * const source = ctx.createMediaElementSource(audioElement)
 * controller.connectSource(source)
 * 
 * // Start lip sync
 * controller.start('voice-id')
 * 
 * // Update every frame (40 FPS)
 * app.ticker.add(() => {
 *   const mouthOpen = controller.update(deltaTime)
 *   model.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', mouthOpen)
 * })
 * 
 * // Stop lip sync
 * controller.stop()
 * ```
 */
export class LipSyncController {
  // ========================================================================
  // Audio Analysis
  // ========================================================================
  
  /** Shared AudioContext instance */
  private ctx: AudioContext
  
  /** FFT analyzer for frequency spectrum analysis */
  private analyser: AnalyserNode
  
  /** Frequency data buffer (Uint8Array for performance) */
  private data: Uint8Array<ArrayBuffer>
  
  /** Mix bus for combining multiple audio sources */
  private mixBus: GainNode
  
  // ========================================================================
  // Gate & Envelope Parameters
  // ========================================================================
  
  /** Noise gate threshold in dB (below this = silence) */
  private gateDb: number = -55
  
  /** Typical speaking level in dB (maps to ~0.8 mouth open) */
  private openDb: number = -25
  
  /** Gate hysteresis in dB (prevents flutter on/off) */
  private hysteresis: number = 4
  
  /** Maximum mouth opening value (use 1.0 to allow full range after perceptual curve) */
  private maxOpen: number = 1.0
  
  // ========================================================================
  // Envelope Timing (seconds)
  // ========================================================================
  
  /** Attack time - how fast mouth opens (faster = more responsive) */
  private attackTime: number = 0.04  // Faster attack for responsive lip sync
  
  /** Release time - how fast mouth closes (slower = more natural) */
  private releaseTime: number = 0.10  // Faster release for more variation
  
  // ========================================================================
  // State
  // ========================================================================
  
  /** Current envelope value [0..1] */
  private envelope: number = 0
  
  /** Whether currently in speaking mode */
  private speaking: boolean = false
  
  /** Last gate state (for hysteresis logic) */
  private lastGateState: boolean = false
  
  /** Whether auto-calibration is in progress */
  private calibrating: boolean = false
  
  /** Collected dB samples during calibration (first 300ms) */
  private calibrationSamples: number[] = []
  
  /** Voice-specific calibration presets */
  private voicePresets: Map<string, VoicePreset> = new Map()
  
  /** Currently active voice ID */
  private currentVoice: string = 'default'
  
  // ========================================================================
  // Constructor
  // ========================================================================
  
  /**
   * Create a new LipSyncController.
   * 
   * @param ctx - Shared AudioContext instance (reuse across app)
   */
  constructor(ctx: AudioContext) {
    this.ctx = ctx
    
    // Create mix bus for multiple audio sources
    this.mixBus = ctx.createGain()
    this.mixBus.gain.value = 1.0
    
    // Create analyser with optimal settings
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 256 // 128 frequency bins (power of 2)
    this.analyser.smoothingTimeConstant = 0.8 // 80% smoothing for stability
    
    // Connect: mixBus → analyser (analyser will be connected to destination by caller)
    this.mixBus.connect(this.analyser)
    
    // Allocate frequency data buffer
    this.data = new Uint8Array(this.analyser.frequencyBinCount)
    
    log.log(' Controller initialized')
    log.log(` FFT size: ${this.analyser.fftSize}, Bins: ${this.analyser.frequencyBinCount}`)

    // Load persisted voice presets (fire and forget)
    this.loadPersistedPresets()
  }
  
  // ========================================================================
  // Public API
  // ========================================================================
  
  /**
   * Connect an audio source to the lip sync analyzer.
   * Call this when audio starts playing.
   * 
   * @param source - Audio source node (MediaElementSource or AudioBufferSource)
   * 
   * @example
   * ```typescript
   * const audioElement = new Audio('speech.mp3')
   * const source = ctx.createMediaElementSource(audioElement)
   * controller.connectSource(source)
   * controller.connectAnalyserToDestination()
   * ```
   */
  connectSource(source: MediaElementAudioSourceNode | AudioBufferSourceNode): void {
    source.connect(this.mixBus)
    log.log(' Audio source connected')
  }
  
  /**
   * Connect the analyser to audio destination (speakers).
   * Call this after connectSource() to enable audio playback.
   * This completes the audio chain: source → mixBus → analyser → destination
   */
  connectAnalyserToDestination(): void {
    this.analyser.connect(this.ctx.destination)
    log.log(' Analyser connected to destination')
  }
  
  /**
   * Start lip sync (call on speaking:start event).
   * Optionally provide voice ID for preset selection and calibration.
   * 
   * @param voiceId - Optional voice identifier for per-voice calibration
   * 
   * @example
   * ```typescript
   * bus.on('avatar', (event) => {
   *   if (event.type === 'speaking:start') {
   *     controller.start(event.voiceId)
   *   }
   * })
   * ```
   */
  start(voiceId?: string): void {
    this.speaking = true
    this.envelope = 0 // Reset envelope
    this.lastGateState = false
    
    // Apply voice preset if available
    if (voiceId && this.voicePresets.has(voiceId)) {
      this.applyVoicePreset(voiceId)
      this.currentVoice = voiceId
    } else {
      this.currentVoice = voiceId || 'default'
    }
    
    // Start auto-calibration
    this.startCalibration()
    
    log.log(` Started (voice: ${this.currentVoice})`)
  }
  
  /**
   * Stop lip sync (call on speaking:stop event).
   * Envelope will decay naturally in update() method.
   * 
   * @example
   * ```typescript
   * bus.on('avatar', (event) => {
   *   if (event.type === 'speaking:stop') {
   *     controller.stop()
   *   }
   * })
   * ```
   */
  stop(): void {
    this.speaking = false
    log.log(' Stopped (envelope will decay)')
  }
  
  /**
   * Update envelope and return mouth open value [0..maxOpen].
   * Call this every frame from PIXI ticker.
   * 
   * @param deltaTime - Time since last frame (seconds)
   * @returns Mouth open value [0..maxOpen]
   * 
   * @example
   * ```typescript
   * let lastTime = performance.now()
   * 
   * app.ticker.add(() => {
   *   const now = performance.now()
   *   const dt = (now - lastTime) / 1000
   *   lastTime = now
   *   
   *   const mouthOpen = controller.update(dt)
   *   model.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', mouthOpen)
   * })
   * ```
   */
  update(deltaTime: number): number {
    // Allow envelope to decay naturally when not speaking
    if (!this.speaking) {
      if (this.envelope > 0.001) {
        const decayRate = 1 - Math.exp(-deltaTime / this.releaseTime)
        this.envelope -= this.envelope * decayRate
        
        // Perceptual curve (ease-out quadratic)
        const eased = 1 - Math.pow(1 - this.envelope, 2)
        return Math.min(this.maxOpen, eased)
      }
      return 0
    }
    
    // Get current loudness in dB
    const currentDb = this.calculateLoudnessDb()
    
    // Auto-calibration on first 300ms of speech (~12 frames at 40 FPS)
    if (this.calibrating) {
      this.calibrationSamples.push(currentDb)
      if (this.calibrationSamples.length >= 12) {
        this.finishCalibration()
      }
    }
    
    // Noise gate with hysteresis (prevents flutter on/off)
    const gateOpenThreshold = this.gateDb + this.hysteresis
    const gateCloseThreshold = this.gateDb
    
    let gateOpen: boolean
    if (this.lastGateState) {
      // Currently open: use lower threshold to close (hysteresis)
      gateOpen = currentDb >= gateCloseThreshold
    } else {
      // Currently closed: use higher threshold to open
      gateOpen = currentDb >= gateOpenThreshold
    }
    
    // Keep gate open if envelope is active (prevents premature closure)
    if (this.envelope > 0.05) {
      gateOpen = gateOpen || currentDb >= gateCloseThreshold
    }
    
    this.lastGateState = gateOpen
    
    // Calculate target envelope value
    const gatedDb = gateOpen ? currentDb : -120
    
    // Map dB to target [0..1] within speaking window
    const normalizedLevel = (gatedDb - this.gateDb) / (this.openDb - this.gateDb)
    const target = Math.max(0, Math.min(1, normalizedLevel))
    
    // Attack/decay envelope (exponential curves for natural feel)
    const isAttacking = target > this.envelope
    const envelopeRate = isAttacking
      ? 1 - Math.exp(-deltaTime / this.attackTime)  // Fast attack
      : 1 - Math.exp(-deltaTime / this.releaseTime) // Slower release
    
    this.envelope += envelopeRate * (target - this.envelope)
    
    // Perceptual curve (ease-out quadratic for more natural movement)
    const eased = 1 - Math.pow(1 - this.envelope, 2)
    
    // Cap at maxOpen
    return Math.min(this.maxOpen, eased)
  }
  
  /**
   * Get real-time telemetry data for debugging and tuning.
   * 
   * @returns Current telemetry snapshot
   * 
   * @example
   * ```typescript
   * const telem = controller.getTelemetry()
   * console.log(`dB: ${telem.currentDb.toFixed(1)}, Env: ${telem.envelope.toFixed(2)}`)
   * ```
   */
  getTelemetry(): LipSyncTelemetry {
    const currentDb = this.calculateLoudnessDb()
    return {
      currentDb,
      envelope: this.envelope,
      gateOpen: this.lastGateState,
      speaking: this.speaking,
      calibrating: this.calibrating,
      currentVoice: this.currentVoice,
      gateDb: this.gateDb,
      openDb: this.openDb
    }
  }
  
  /**
   * Manually adjust noise gate threshold.
   * Lower values = more sensitive (mouth opens easier).
   * Higher values = less sensitive (filters more noise).
   * 
   * @param db - Gate threshold in dB (typically -60 to -50)
   */
  setGate(db: number): void {
    this.gateDb = db
    log.log(` Gate set to ${db}dB`)
  }
  
  /**
   * Manually adjust speaking level reference.
   * This is the dB level that maps to ~0.8 mouth opening.
   * 
   * @param db - Speaking level in dB (typically -30 to -20)
   */
  setSpeakingLevel(db: number): void {
    this.openDb = db
    log.log(` Speaking level set to ${db}dB`)
  }
  
  /**
   * Cleanup resources and disconnect audio graph.
   * Call this when destroying the overlay.
   */
  destroy(): void {
    this.analyser.disconnect()
    this.mixBus.disconnect()
    this.speaking = false
    this.envelope = 0
    log.log(' Controller destroyed')
  }
  
  // ========================================================================
  // Private Methods - Audio Analysis
  // ========================================================================
  
  /**
   * Calculate RMS loudness in dB from frequency spectrum.
   * Uses root-mean-square of frequency bins, converted to decibels.
   * 
   * @returns Loudness in dB (range: ~[-120, 0])
   */
  private calculateLoudnessDb(): number {
    // Get frequency spectrum (0-255 per bin)
    this.analyser.getByteFrequencyData(this.data)

    // Focus on speech-relevant frequencies (formants F1 & F2)
    // With FFT=256 and ~48kHz sample rate: each bin ≈ 187Hz
    // Speech formants: F1 (200-1000Hz) = bins 1-5, F2 (500-3000Hz) = bins 3-16
    // We'll use bins 1-20 (~200Hz to ~3700Hz) for speech energy
    const speechStartBin = 1
    const speechEndBin = Math.min(20, this.data.length)

    // Calculate RMS only for speech frequencies (much more responsive)
    let sum = 0
    let count = 0
    for (let i = speechStartBin; i < speechEndBin; i++) {
      const normalized = this.data[i] / 255 // Convert to 0-1 range
      sum += normalized * normalized
      count++
    }
    const rms = Math.sqrt(sum / count)

    // Convert to dB (add floor to prevent -Infinity)
    // 1e-6 = -120 dB floor (effectively silence)
    const db = 20 * Math.log10(rms + 1e-6)

    return db
  }
  
  // ========================================================================
  // Private Methods - Calibration
  // ========================================================================
  
  /**
   * Start auto-calibration to adapt to voice characteristics.
   * Collects samples for the first ~300ms of speech.
   */
  private startCalibration(): void {
    this.calibrating = true
    this.calibrationSamples = []
    log.log(' Starting auto-calibration...')
  }
  
  /**
   * Finish calibration and adjust parameters based on measured levels.
   * Sets openDb to peak level and gateDb based on average level.
   */
  private finishCalibration(): void {
    this.calibrating = false
    
    // Calculate peak and average dB from samples
    const peakDb = Math.max(...this.calibrationSamples)
    const avgDb = this.calibrationSamples.reduce((a, b) => a + b, 0) / this.calibrationSamples.length
    
    log.log(` Calibration complete: peak=${peakDb.toFixed(1)}dB, avg=${avgDb.toFixed(1)}dB`)
    
    // Only calibrate if we have valid speech signal (not silence)
    if (peakDb > -100) {
      // Set openDb to peak level (loudest parts = full mouth open)
      this.openDb = peakDb
      
      // Set gateDb slightly below average (quiet parts close mouth)
      // Use average - 5dB to allow some variation before closing
      this.gateDb = Math.min(avgDb - 5, this.openDb - 8)
      
      log.log(` Set openDb=${this.openDb.toFixed(1)}dB, gateDb=${this.gateDb.toFixed(1)}dB`)
      
      // Save preset for this voice
      this.saveVoicePreset(this.currentVoice, {
        gateDb: this.gateDb,
        openDb: this.openDb,
        maxOpen: this.maxOpen,
        peakDb,
        avgDb
      })
    } else {
      log.warn(' Calibration failed: signal too weak')
    }
  }
  
  /**
   * Save calibrated parameters as a voice preset.
   * Allows reusing calibration across sessions.
   *
   * @param voiceId - Voice identifier
   * @param preset - Calibrated parameters
   */
  private saveVoicePreset(voiceId: string, preset: VoicePreset): void {
    this.voicePresets.set(voiceId, preset)
    log.log(` Saved preset for voice: ${voiceId}`)

    // Persist to chrome.storage.local for cross-session reuse
    this.persistPresets().catch(() => {
      // Non-critical, silent fail
    })
  }

  /**
   * Persist all voice presets to chrome.storage.local.
   */
  private async persistPresets(): Promise<void> {
    try {
      const presets: Record<string, VoicePreset> = {}
      this.voicePresets.forEach((preset, voiceId) => {
        presets[voiceId] = preset
      })
      await chrome.storage.local.set({ 'yumi-voice-presets': presets })
    } catch (err) {
      // Storage might not be available in all contexts
    }
  }

  /**
   * Load persisted voice presets from chrome.storage.local.
   */
  async loadPersistedPresets(): Promise<void> {
    try {
      const data = await chrome.storage.local.get('yumi-voice-presets')
      const presets = data?.['yumi-voice-presets'] || {}
      for (const [voiceId, preset] of Object.entries(presets)) {
        this.voicePresets.set(voiceId, preset as VoicePreset)
      }
      if (this.voicePresets.size > 0) {
        log.log(` Loaded ${this.voicePresets.size} voice presets from storage`)
      }
    } catch (err) {
      // Storage might not be available in all contexts
    }
  }
  
  /**
   * Apply a saved voice preset.
   * 
   * @param voiceId - Voice identifier
   */
  private applyVoicePreset(voiceId: string): void {
    const preset = this.voicePresets.get(voiceId)
    if (!preset) return
    
    this.gateDb = preset.gateDb
    this.openDb = preset.openDb
    this.maxOpen = preset.maxOpen
    
    log.log(` Applied preset for voice: ${voiceId}`)
  }
}
