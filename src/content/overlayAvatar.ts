// Injects a Live2D avatar overlay into the current page.
// Keeps implementation minimal and isolated under a shadow root to avoid CSS collisions.

// ESM imports for bundling with Vite
import * as PIXI from 'pixi.js'
import { createLogger } from '../lib/core/debug'
import { AVATAR, BREAKPOINTS } from '../lib/design/dimensions'
import { sttService } from '../lib/stt/sttService'
import { useSettingsStore } from '../lib/stores/settings.store'

declare const __DEV__: boolean
const log = createLogger('Overlay')
import { install as installUnsafeEval } from '@pixi/unsafe-eval'
// LipSyncController removed - using pixi-live2d-display-lipsyncpatch built-in lip sync
// bus import removed - no longer needed for lip sync events
// Import Tailwind CSS to be bundled with content script
import './styles'

// Install unsafe-eval patch for Chrome extension CSP compatibility
installUnsafeEval(PIXI)

/**
 * Patch Live2D URL resolver to handle blob URLs correctly.
 * Must be called on the SAME module instance that loads models.
 * This is critical for installed companions loaded from IndexedDB.
 */
let patchedLive2D = false
function patchResolveURL(Cubism4ModelSettings: any): void {
  if (patchedLive2D) return

  const originalResolveURL = Cubism4ModelSettings.prototype.resolveURL
  Cubism4ModelSettings.prototype.resolveURL = function (path: string): string {
    if (path.startsWith('blob:')) {
      log.log(`[PATCH] resolveURL: blob URL passed through`)
      return path
    }
    return originalResolveURL.call(this, path)
  }

  patchedLive2D = true
  log.log('[OK] Patched Live2D URL resolver for blob URL support')
}

// Configure PIXI settings before any usage
if (PIXI.settings) {
  PIXI.settings.FAIL_IF_MAJOR_PERFORMANCE_CAVEAT = false
}

// Expose PIXI globally for Live2D (required by library)
// This allows the library to automatically register Ticker updates
(window as any).PIXI = PIXI

// Note: We CANNOT import Live2DModel at the top level because it checks for
// Live2DCubismCore immediately upon import. We must dynamically import it
// AFTER the SDK is loaded.

// Feature flags removed - lip sync now handled by pixi-live2d-display-lipsyncpatch

// Use centralized dimension constants
const BASE_WIDTH = AVATAR.baseWidth
const BASE_HEIGHT = AVATAR.baseHeight
const PADDING = AVATAR.padding

/**
 * Timer tracking for memory leak prevention
 * All setTimeout/setInterval calls must be tracked and cleared on unmount
 */
const activeTimers = new Set<ReturnType<typeof setTimeout>>()
const activeIntervals = new Set<ReturnType<typeof setInterval>>()

function trackTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout> {
  const id = setTimeout(() => {
    activeTimers.delete(id)
    callback()
  }, ms)
  activeTimers.add(id)
  return id
}

function trackInterval(callback: () => void, ms: number): ReturnType<typeof setInterval> {
  const id = setInterval(callback, ms)
  activeIntervals.add(id)
  return id
}

function clearAllTimers() {
  activeTimers.forEach(id => clearTimeout(id))
  activeTimers.clear()
  activeIntervals.forEach(id => clearInterval(id))
  activeIntervals.clear()
}

// Configuration pulled via message (so we don't need storage permissions here)
interface OverlayConfig {
  modelUrl: string
  scale: number
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  modelOffsetX?: number  // Custom X offset for model within canvas (-1000 to 1000)
  modelOffsetY?: number  // Custom Y offset for model within canvas (-1000 to 1000)
  modelScaleMultiplier?: number  // Additional scale multiplier (0.5 to 10.0)
}

// Maintain single instance (singleton guard for SPA navigation)
let container: HTMLElement | null = null // Wrapper container (avatar + chat)
let avatarContainer: HTMLElement | null = null // Avatar container with shadow DOM
let app: any | null = null
let model: any | null = null
let dragging = false
let dragOffsetX = 0
let dragOffsetY = 0
let isInitializing = false // Prevent double initialization

// Lip sync state removed - using pixi-live2d-display-lipsyncpatch built-in lip sync

// Debug panel state - values to apply every frame (for manual parameter tuning)
let debugPanelActive = false
let debugPanelValues: Record<string, number> = {}

// Lip sync state - mouth open value to apply in beforeModelUpdate
let lipSyncMouthValue = 0

async function ensureCubismCoreLoaded(timeoutMs = 2000): Promise<void> {
  // SDK is already loaded by manifest.json in correct order:
  // 1. prelude.js (set Module.locateFile)
  // 2. cubism-sdk/live2dcubismcore.min.js (load SDK + WASM)
  // 3. content.js (this file)
  
  // Poll for WASM readiness with 50ms intervals
  const start = performance.now()
  
  while (performance.now() - start < timeoutMs) {
    const core = (window as any).Live2DCubismCore
    
    // Check if WASM is fully initialized (not just JS wrapper)
    if (core?.Moc && typeof core.Moc.fromArrayBuffer === 'function') {
      log.log('[OK] Cubism 4 SDK ready (WASM initialized)')
      return
    }
    
    // Wait 50ms before next check
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  
  // Timeout reached - SDK failed to initialize
  const core = (window as any).Live2DCubismCore
  log.error('[ERROR] Cubism SDK WASM failed to initialize')
  log.error('Core object:', core)
  log.error('Check if:')
  log.error('  1. prelude.js loaded and set Module.locateFile')
  log.error('  2. live2dcubismcore.min.js loaded successfully')
  log.error('  3. live2dcubismcore.wasm is in cubism-sdk/ and web_accessible_resources')
  
  throw new Error(`Cubism SDK failed to initialize (WASM not ready after ${timeoutMs}ms)`)
}

// AudioContext removed - pixi-live2d-display-lipsyncpatch handles audio internally

// initLipSync removed - pixi-live2d-display-lipsyncpatch handles lip sync internally via model.speak()

/**
 * Initialize debug panel hook for manual parameter tuning.
 * Also applies lip sync mouth values here for correct timing.
 * Native expressions are handled by pixi-live2d-display's expression system.
 *
 * NOTE: For installed companions loaded from blob URLs, internalModel may not
 * be immediately available after Live2DModel.from() resolves. We poll until ready.
 */
async function initDebugPanelHook(): Promise<void> {
  console.log('[HOOK DEBUG] initDebugPanelHook called, model exists:', !!model)
  console.log('[HOOK DEBUG] internalModel exists:', !!model?.internalModel)

  /** Wait for internalModel to be available (may be async for blob URLs) */
  let attempts = 0
  const maxAttempts = 50  /** 5 seconds max wait (50 * 100ms) */
  while (!model?.internalModel && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 100))
    attempts++
    if (attempts % 10 === 0) {
      console.log(`[HOOK DEBUG] Waiting for internalModel... attempt ${attempts}`)
    }
  }

  if (!model?.internalModel) {
    console.error('[HOOK FAIL] internalModel not available after 5 seconds - lip sync disabled')
    return
  }

  if (attempts > 0) {
    console.log(`[HOOK OK] internalModel ready after ${attempts * 100}ms`)
  } else {
    console.log('[HOOK OK] internalModel was immediately available')
  }

  /**
   * Hook into afterMotionUpdate for lip sync.
   * This fires AFTER expressions are applied by motionManager.update(),
   * allowing lip sync to blend with expression values rather than overwriting them.
   */
  let lipSyncLogCounter = 0
  let hookCallCounter = 0
  model.internalModel.on('afterMotionUpdate', () => {
    hookCallCounter++
    if (hookCallCounter % 120 === 1) {
      console.log(`[afterMotionUpdate] Hook fired, lipSyncMouthValue: ${lipSyncMouthValue.toFixed(2)}, debugPanelActive: ${debugPanelActive}`)
    }

    if (debugPanelActive) return

    if (lipSyncMouthValue > 0) {
      try {
        const coreModel = model.internalModel.coreModel
        coreModel.setParameterValueById('ParamMouthOpenY', lipSyncMouthValue, 1.0)

        lipSyncLogCounter++
        if (lipSyncLogCounter % 30 === 1) {
          console.log(`[LipSync] Mouth value: ${lipSyncMouthValue.toFixed(2)}`)
        }
      } catch (err) {
        /** Parameter might not exist */
      }
    } else if (lipSyncLogCounter > 0) {
      console.log('[LipSync] Mouth closed')
      lipSyncLogCounter = 0
    }
  })
  console.log('[HOOK OK] Lip sync hook initialized (afterMotionUpdate)')

  /**
   * Hook into beforeModelUpdate for debug panel override.
   * This fires right before rendering, allowing debug panel to override ALL values.
   */
  model.internalModel.on('beforeModelUpdate', () => {
    if (debugPanelActive && Object.keys(debugPanelValues).length > 0) {
      try {
        const coreModel = model.internalModel.coreModel
        for (const [paramId, value] of Object.entries(debugPanelValues)) {
          coreModel.setParameterValueById(paramId, value, 1.0)
        }
      } catch (err) {
        /** Silently fail */
      }
    }
  })
  console.log('[HOOK OK] Debug panel hook initialized (beforeModelUpdate)')
}

/**
 * Preload all expressions to avoid lazy loading issues.
 * pixi-live2d-display loads expressions lazily by default, which means
 * expressions are only loaded when first requested. This can cause
 * expression changes to fail if the expression file hasn't been loaded yet.
 */
async function preloadExpressions(): Promise<void> {
  const em = (model as any)?.internalModel?.motionManager?.expressionManager
  if (!em || !em.definitions) {
    console.log('[Expressions] No expression manager or definitions found')
    return
  }

  console.log(`[Expressions] Preloading ${em.definitions.length} expressions...`)

  for (let i = 0; i < em.definitions.length; i++) {
    try {
      await em.loadExpression(i)
      console.log(`[Expressions] Loaded: ${em.definitions[i]?.Name}`)
    } catch (err) {
      console.error(`[Expressions] Failed to load ${em.definitions[i]?.Name}:`, err)
    }
  }

  console.log('[Expressions] Preload complete')
}

// connectAudio removed - pixi-live2d-display-lipsyncpatch handles audio connection internally

// getValidMouthParam removed - model.json now has LipSync.Ids configured

function positionContainer(pos: OverlayConfig['position']) {
  if (!container) return
  container.style.top = 'unset'
  container.style.bottom = 'unset'
  container.style.left = 'unset'
  container.style.right = 'unset'
  switch (pos) {
    case 'bottom-right':
      container.style.bottom = '16px'
      container.style.right = '16px'
      break
    case 'bottom-left':
      container.style.bottom = '16px'
      container.style.left = '16px'
      break
    case 'top-right':
      container.style.top = '16px'
      container.style.right = '16px'
      break
    case 'top-left':
      container.style.top = '16px'
      container.style.left = '16px'
      break
  }
}

async function createOverlay(cfg: OverlayConfig) {
  log.log('createOverlay called')

  // Singleton guard: prevent double-mounting on SPA navigation
  if (container) {
    log.log('[WARN] Container already exists, skipping (singleton guard)')
    return
  }

  if (isInitializing) {
    log.log('[WARN] Already initializing, skipping (race guard)')
    return
  }
  
  isInitializing = true
  
  try {
    const userScale = cfg.scale ?? 1
    
    // Apply scale to container size
    const containerWidth = Math.round(BASE_WIDTH * userScale)
    const containerHeight = Math.round(BASE_HEIGHT * userScale)
    
    // Check for narrow screens
    const isNarrow = window.innerWidth < BREAKPOINTS.narrow
    
    // Create wrapper container for avatar + chat (docked layout)
    container = document.createElement('div')
    container.className = 'yumi-overlay-wrapper'
    Object.assign(container.style, {
      position: 'fixed',
      right: isNarrow ? '50%' : '16px',
      bottom: '16px',
      transform: isNarrow ? 'translateX(50%)' : 'none',
      zIndex: 2147483647, // max z-index
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: '12px',
      pointerEvents: 'none', // Allow clicks through wrapper
      transition: 'right 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), bottom 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)'
    })
    
    // Create avatar container (Live2D canvas goes here)
    avatarContainer = document.createElement('div')
    avatarContainer.className = 'yumi-avatar-container'
    Object.assign(avatarContainer.style, {
      width: `${containerWidth}px`,
      height: `${containerHeight}px`,
      position: 'relative',
      pointerEvents: 'auto',
      userSelect: 'none',
      opacity: '0',
      transform: 'scale(0.8)',
      transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)'
    })
    container.appendChild(avatarContainer)
    
    // Trigger entrance animation after mount
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (avatarContainer) {
          avatarContainer.style.opacity = '1'
          avatarContainer.style.transform = 'scale(1)'
        }
      })
    })

  // Shadow root isolation (attach to avatar container, not wrapper)
  const shadow = avatarContainer.attachShadow({ mode: 'open' })
  const canvasWrapper = document.createElement('div')
  Object.assign(canvasWrapper.style, {
    width: '100%',
    height: '100%',
    background: 'transparent',
    position: 'relative'
  })

  // Loading spinner while model loads
  const loadingSpinner = document.createElement('div')
  loadingSpinner.className = 'yumi-loading-spinner'
  Object.assign(loadingSpinner.style, {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    border: '3px solid rgba(255, 255, 255, 0.15)',
    borderTopColor: 'rgba(139, 92, 246, 0.8)',
    animation: 'yumi-spin 0.8s linear infinite',
    zIndex: '5'
  })

  // Add keyframes for spinner animation
  const spinnerStyle = document.createElement('style')
  spinnerStyle.textContent = `
    @keyframes yumi-spin {
      to { transform: translate(-50%, -50%) rotate(360deg); }
    }
  `
  canvasWrapper.appendChild(spinnerStyle)
  canvasWrapper.appendChild(loadingSpinner)

  const canvas = document.createElement('canvas')
  Object.assign(canvas.style, {
    width: '100%', height: '100%', display: 'block'
  })
  canvasWrapper.appendChild(canvas)

  // Unified vertical button panel (glassmorphism design)
  const buttonPanel = document.createElement('div')
  Object.assign(buttonPanel.style, {
    position: 'absolute',
    top: '50%',
    right: '8px',
    transform: 'translateY(-50%)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '8px',
    background: 'rgba(0, 0, 0, 0.75)',
    backdropFilter: 'blur(10px)',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
    zIndex: '10'
  })

  // Drag button
  const dragHandle = document.createElement('button')
  dragHandle.textContent = '⇕'
  Object.assign(dragHandle.style, {
    width: '40px',
    height: '40px',
    background: 'rgba(255, 255, 255, 0.1)',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'grab',
    fontSize: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
    pointerEvents: 'auto'
  })
  dragHandle.style.transition = 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)'
  dragHandle.onmouseenter = () => {
    dragHandle.style.background = 'rgba(255, 255, 255, 0.2)'
    dragHandle.style.transform = 'scale(1.15) rotate(5deg)'
  }
  dragHandle.onmouseleave = () => {
    if (!dragging) {
      dragHandle.style.background = 'rgba(255, 255, 255, 0.1)'
      dragHandle.style.transform = 'scale(1) rotate(0deg)'
    }
  }
  dragHandle.onmousedown = (e) => {
    dragging = true
    // Calculate offset from wrapper's current position
    const rect = container!.getBoundingClientRect()
    dragOffsetX = e.clientX - rect.left
    dragOffsetY = e.clientY - rect.top
    dragHandle.style.cursor = 'grabbing'
    dragHandle.style.background = 'rgba(255, 255, 255, 0.3)'
    e.preventDefault()
  }
  window.addEventListener('mousemove', (e) => {
    if (!dragging || !container) return
    // Update wrapper position (both avatar + chat move together)
    container.style.left = `${e.clientX - dragOffsetX}px`
    container.style.bottom = `${window.innerHeight - (e.clientY - dragOffsetY + container.offsetHeight)}px`
    container.style.right = 'unset'
    container.style.transform = 'none' // Remove any transform when manually positioned
  })
  window.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false
      dragHandle.style.cursor = 'grab'
      dragHandle.style.background = 'rgba(255, 255, 255, 0.1)'
    }
  })

  // Chat toggle button (will be controlled by React)
  const chatBtn = document.createElement('button')
  chatBtn.textContent = '💬'
  chatBtn.id = 'yumi-chat-toggle'
  Object.assign(chatBtn.style, {
    width: '40px',
    height: '40px',
    background: 'rgba(255, 255, 255, 0.1)',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
    pointerEvents: 'auto'
  })
  chatBtn.style.transition = 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)'
  chatBtn.onmouseenter = () => {
    if (!chatBtn.classList.contains('active')) {
      chatBtn.style.background = 'rgba(255, 255, 255, 0.2)'
      chatBtn.style.transform = 'scale(1.15) rotate(-5deg)'
      chatBtn.style.boxShadow = '0 4px 12px rgba(139, 92, 246, 0.3)'
    }
  }
  chatBtn.onmouseleave = () => {
    if (!chatBtn.classList.contains('active')) {
      chatBtn.style.background = 'rgba(255, 255, 255, 0.1)'
      chatBtn.style.transform = 'scale(1) rotate(0deg)'
      chatBtn.style.boxShadow = 'none'
    }
  }

  // Close button
  const closeBtn = document.createElement('button')
  closeBtn.textContent = '×'
  Object.assign(closeBtn.style, {
    width: '40px',
    height: '40px',
    background: 'rgba(255, 255, 255, 0.1)',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
    pointerEvents: 'auto'
  })
  closeBtn.style.transition = 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)'
  closeBtn.onmouseenter = () => {
    closeBtn.style.background = 'rgba(239, 68, 68, 0.8)'
    closeBtn.style.transform = 'scale(1.15) rotate(90deg)'
    closeBtn.style.boxShadow = '0 4px 12px rgba(239, 68, 68, 0.4)'
  }
  closeBtn.onmouseleave = () => {
    closeBtn.style.background = 'rgba(255, 255, 255, 0.1)'
    closeBtn.style.transform = 'scale(1) rotate(0deg)'
    closeBtn.style.boxShadow = 'none'
  }
  closeBtn.onclick = () => destroyOverlay()

  // Mic button (STT push-to-talk)
  const micBtn = document.createElement('button')
  micBtn.textContent = '🎤'
  micBtn.id = 'yumi-mic-toggle'
  let micRecording = false
  let micDurationInterval: ReturnType<typeof setInterval> | null = null
  Object.assign(micBtn.style, {
    width: '40px',
    height: '40px',
    background: 'rgba(255, 255, 255, 0.1)',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '18px',
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
    pointerEvents: 'auto'
  })

  const updateMicVisibility = () => {
    const state = useSettingsStore.getState()
    const shouldShow = state.sttEnabled && state.hubAccessToken
    micBtn.style.display = shouldShow ? 'flex' : 'none'
    if (shouldShow && state.hubAccessToken) {
      sttService.initialize(state.hubUrl, state.hubAccessToken, { enabled: true })
    }
  }
  updateMicVisibility()
  useSettingsStore.subscribe(updateMicVisibility)

  const resetMicButton = () => {
    micRecording = false
    if (micDurationInterval) {
      clearInterval(micDurationInterval)
      activeIntervals.delete(micDurationInterval)
      micDurationInterval = null
    }
    micBtn.style.background = 'rgba(255, 255, 255, 0.1)'
    micBtn.style.transform = 'scale(1)'
    micBtn.style.boxShadow = 'none'
    micBtn.textContent = '🎤'
  }

  const showError = () => {
    micBtn.style.background = 'rgba(239, 68, 68, 0.8)'
    micBtn.textContent = '!'
    trackTimeout(resetMicButton, 1500)
  }

  micBtn.onmouseenter = () => {
    if (!micRecording) {
      micBtn.style.background = 'rgba(255, 255, 255, 0.2)'
      micBtn.style.transform = 'scale(1.15)'
    }
  }
  micBtn.onmouseleave = () => {
    if (!micRecording) {
      micBtn.style.background = 'rgba(255, 255, 255, 0.1)'
      micBtn.style.transform = 'scale(1)'
    }
    if (micRecording) {
      sttService.cancelRecording()
      resetMicButton()
    }
  }
  micBtn.onmousedown = async (e) => {
    e.preventDefault()
    const state = useSettingsStore.getState()
    if (!state.sttEnabled || !state.hubAccessToken) return

    const started = await sttService.startRecording()
    if (started) {
      micRecording = true
      micBtn.style.background = 'rgba(239, 68, 68, 0.8)'
      micBtn.style.transform = 'scale(1.1)'
      micBtn.style.boxShadow = '0 0 12px rgba(239, 68, 68, 0.5)'
      micBtn.textContent = '0s'
      micDurationInterval = trackInterval(() => {
        const duration = Math.floor(sttService.getRecordingDuration() / 1000)
        micBtn.textContent = `${duration}s`
      }, 100)
    }
  }
  micBtn.onmouseup = async () => {
    if (!micRecording) return
    if (micDurationInterval) {
      clearInterval(micDurationInterval)
      activeIntervals.delete(micDurationInterval)
      micDurationInterval = null
    }
    micBtn.textContent = '...'
    micBtn.style.background = 'rgba(255, 255, 255, 0.2)'
    micBtn.style.boxShadow = 'none'
    micRecording = false

    const text = await sttService.stopRecordingAndTranscribe()
    if (text) {
      resetMicButton()
      const inputEvent = new CustomEvent('yumi-stt-result', { detail: { text } })
      document.dispatchEvent(inputEvent)
    } else {
      showError()
    }
  }

  buttonPanel.appendChild(dragHandle)
  buttonPanel.appendChild(chatBtn)
  buttonPanel.appendChild(micBtn)
  buttonPanel.appendChild(closeBtn)
  canvasWrapper.appendChild(buttonPanel)

  shadow.appendChild(canvasWrapper)

    document.documentElement.appendChild(container)

    // 1. Ensure Cubism 4 Core SDK is loaded first
    await ensureCubismCoreLoaded()
    log.log('[OK] Cubism Core SDK loaded')

    // 2. Provide Cubism 2 stub BEFORE any pixi-live2d-display operations
    // This prevents runtime checks from failing even with /lib/cubism4 import
    if (!(window as any).Live2D) {
      (window as any).Live2D = { getError: () => null }
      log.log('[OK] Cubism 2 stub installed')
    }

    // 3. Test WebGL support before creating app
    const testCanvas = document.createElement('canvas')
    const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl')
    if (!gl) {
      throw new Error('WebGL is not supported in this context')
    }
    log.log('[OK] WebGL context test passed')

    // 4. Create PIXI Application with safe settings
    app = new PIXI.Application({
      view: canvas,
      backgroundAlpha: 0,
      autoStart: true,
      antialias: true,
      resizeTo: canvasWrapper,
      forceCanvas: false,
      powerPreference: 'default',
      sharedTicker: true,
      sharedLoader: true
    })

    // Cap FPS to 30-45 for battery life (default is ~60fps)
    app.ticker.maxFPS = 40

    // Destroy InteractionManager plugin to prevent errors from @pixi/interaction aliasing
    // We use our own canvas click handler for tap reactions instead
    if (app.renderer.plugins?.interaction) {
      app.renderer.plugins.interaction.destroy()
      delete app.renderer.plugins.interaction
      log.log('[OK] InteractionManager disabled (using custom handlers)')
    }

    log.log('[OK] PIXI Application created (40 FPS cap)')

    // 5. Dynamically import Live2D library AFTER SDK is loaded
    log.log('Importing Live2D library...')
    const { Live2DModel, MotionPreloadStrategy, config: live2dConfig, Cubism4ModelSettings } = await import('pixi-live2d-display/lib/cubism4')
    log.log('[OK] Live2D library imported')

    // 5.5. Patch URL resolver for blob URL support (installed companions from IndexedDB)
    patchResolveURL(Cubism4ModelSettings)

    // 6. Configure Live2D (quiet logs, no sound)
    live2dConfig.sound = false
    live2dConfig.logLevel = live2dConfig.LOG_LEVEL_ERROR
    
    // 7. Load the Live2D model
    log.log('Loading model from:', cfg.modelUrl)
    model = await Live2DModel.from(cfg.modelUrl, {
      motionPreload: MotionPreloadStrategy.IDLE,
      autoInteract: false // Disabled - causes errors with @pixi/interaction aliasing
    })
    log.log('[OK] Model loaded successfully')

    // Remove loading spinner now that model is ready
    loadingSpinner.remove()

    // 8. Add model to stage first (required to get accurate dimensions)
    app.stage.addChild(model)
    
    // Get actual drawn bounds (not authoring canvas with padding)
    const bounds = model.getLocalBounds()
    log.log(`[DIM] Model canvas: ${model.width?.toFixed(0)}x${model.height?.toFixed(0)}`)
    log.log(`[DIM] Actual content bounds: ${bounds.width.toFixed(0)}x${bounds.height.toFixed(0)}`)
    
    // Calculate base fit scale using ACTUAL content bounds (not artboard)
    const fitX = (BASE_WIDTH * PADDING) / bounds.width
    const fitY = (BASE_HEIGHT * PADDING) / bounds.height
    const baseFitScale = Math.min(fitX, fitY)
    
    // Store baseFitScale on model for lightweight updates
    ;(model as any).__yumiBaseFitScale = baseFitScale
    
    // Get custom model adjustments (defaults to 0/1.0 if not provided)
    const modelOffsetX = cfg.modelOffsetX ?? 0
    const modelOffsetY = cfg.modelOffsetY ?? 0
    const modelScaleMultiplier = cfg.modelScaleMultiplier ?? 1.0
    
    // Final model scale = baseFitScale * userScale * modelScaleMultiplier
    const finalScale = baseFitScale * userScale * modelScaleMultiplier
    model.scale?.set?.(finalScale)
    
    // Set anchor to bottom-center for natural standing pose
    model.anchor.set(0.5, 1.0)
    
    // Position at bottom-center with custom offsets
    model.position.set(
      containerWidth / 2 + modelOffsetX,
      containerHeight - 10 + modelOffsetY  // 10px margin from bottom + custom offset
    )
    
    // Store current base scale on model (for ticker to reference live value)
    ;(model as any).__yumiCurrentScale = finalScale
    
    // Store base positions on model (for ticker to reference live value)
    ;(model as any).__yumiBaseY = model.position.y
    ;(model as any).__yumiBaseX = model.position.x
    
    log.log('[DIM] Scale:', finalScale.toFixed(3) + 'x (base:', baseFitScale.toFixed(3), 'x user:', userScale.toFixed(2), 'x multiplier:', modelScaleMultiplier.toFixed(2), ')')
    log.log(`[POS] Positioned at: (${model.position.x.toFixed(0)}, ${model.position.y.toFixed(0)})`)
    log.log(`[ANCHOR] Anchor: (${model.anchor.x}, ${model.anchor.y}) - bottom-center`)
    
    // 9. Lip sync handled by pixi-live2d-display-lipsyncpatch via model.speak()
    // Debug panel hook for manual parameter tuning (async for blob URL models)
    await initDebugPanelHook()

    // 9.5. Preload all expressions to avoid lazy loading issues with blob URLs
    await preloadExpressions()

    // 10. Add gentle idle animation (breathing effect)
    let t = 0

    app.ticker.add(() => {
      t += 0.015  // Slower, more natural breathing
      if (model) {
        // Enhanced breathing with multiple sine waves for natural movement
        const baseY = (model as any).__yumiBaseY ?? model.position.y
        const baseX = (model as any).__yumiBaseX ?? model.position.x
        
        // Gentle vertical oscillation (±5px) with dual-wave for natural breathing
        const breathWave = Math.sin(t) * 3.5 + Math.sin(t * 0.5) * 1.5
        model.position.x = baseX  // Keep X stable (custom offset preserved)
        model.position.y = baseY + breathWave
        
        // Enhanced scale breathing (±1.2% of current scale) with smooth easing
        const currentScale = (model as any).__yumiCurrentScale ?? 1
        const scaleWave = Math.sin(t * 0.6) * 0.012  // Slightly slower than position
        const breathingScale = currentScale + currentScale * scaleWave
        model.scale?.set?.(breathingScale)
        
        // Subtle rotation for more lifelike idle (±0.5 degrees)
        if (model.rotation !== undefined) {
          const rotationWave = Math.sin(t * 0.3) * 0.008  // Very slow, subtle tilt
          model.rotation = rotationWave
        }
        
        // Lip sync handled by pixi-live2d-display-lipsyncpatch internally
      }
    })
    
    // 11. Pause animation when tab is hidden (battery optimization)
    document.addEventListener('visibilitychange', () => {
      if (!app) return
      if (document.hidden) {
        app.ticker.stop()
        // Don't stop lip sync - let it continue analyzing audio in background
        // The envelope will naturally decay when speech ends
        log.log('[PAUSE] Animation paused (tab hidden)')
      } else {
        app.ticker.start()
        log.log('[RESUME] Animation resumed (tab visible)')
      }
    })
    log.log('[OK] Visibility pause handler registered')
    
    // 12. Handle WebGL context loss/restore (production hardening)
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      log.warn('[WARN] WebGL context lost')
      if (app) app.ticker.stop()
    })

    canvas.addEventListener('webglcontextrestored', async () => {
      log.log('[RESTORE] WebGL context restored, reloading model...')
      try {
        if (app) {
          app.ticker.start()
          // Reload model textures
          if (model) {
            await model.internal?.motionManager?.loadTexture?.()
            log.log('[OK] Model textures rebound')
          }
          // Lip sync will resume on next speaking:start event
        }
      } catch (e) {
        log.error('Failed to restore after context loss:', e)
      }
    })
    log.log('[OK] WebGL context loss handlers registered')

    // 13. Add tap reaction handler (click on avatar triggers random expression)
    const TAP_EXPRESSIONS = ['happy', 'surprised', 'smiling', 'scared']
    let tapIndex = 0
    let lastTapTime = 0
    canvas.addEventListener('click', () => {
      const now = Date.now()
      if (now - lastTapTime < 300) return
      lastTapTime = now

      const expr = TAP_EXPRESSIONS[tapIndex % TAP_EXPRESSIONS.length]
      tapIndex++

      model?.expression(expr)
      log.log(`[TAP] Expression: ${expr}`)

      setTimeout(() => {
        model?.expression('neutral')
      }, 1500)
    })
    log.log('[OK] Tap reaction handler registered')

      // === PHASE 2: Mount React chat overlay in shadow DOM with styles ===
    // Mount AFTER everything else is initialized to avoid circular deps
    const shadowRoot = avatarContainer!.shadowRoot!
    
    // Pre-hydrate stores before mounting React (prevent React Error #185)
    const { usePersonalityStore } = await import('../lib/stores/personality.store')
    const { useSettingsStore: settingsStoreForHydration } = await import('../lib/stores/settings.store')
    
    // Inject styles into shadow DOM
    // The CSS is built as style.css in dist root by Vite during content build
    try {
      const cssUrl = chrome.runtime.getURL('style.css')
      const cssResponse = await fetch(cssUrl).catch(() => null)
      if (cssResponse?.ok) {
        const cssText = await cssResponse.text()
        const styleTag = document.createElement('style')
        styleTag.textContent = cssText
        shadowRoot.appendChild(styleTag)
        log.log('[OK] Tailwind CSS injected into shadow DOM')
      } else {
        log.warn('[WARN] CSS file not found at style.css, using fallback')
      }
    } catch (err) {
      log.warn('[WARN] Failed to load Tailwind CSS:', err)
    }    // Add custom animations for sparkle effects
    const customStyle = document.createElement('style')
    customStyle.textContent = `
      @keyframes sparkle {
        0%, 100% { opacity: 0.7; transform: scale(1); }
        50% { opacity: 1; transform: scale(1.2); }
      }
      .animate-sparkle {
        animation: sparkle 2s ease-in-out infinite;
      }
      .speed-lines {
        background: rgba(255,255,255,0.3);
        animation: speedlines 1s linear infinite;
      }
      @keyframes speedlines {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
      }
    `
    shadowRoot.appendChild(customStyle)
    log.log('[OK] Custom animations injected')
    
    // Create React mount point for chat with its own shadow DOM for style isolation
    const chatContainer = document.createElement('div')
    chatContainer.className = 'yumi-chat-container'
    Object.assign(chatContainer.style, {
      // Participate in flexbox - this is a flex item in the column
      pointerEvents: 'none', // Let chat manage its own pointer events
      alignSelf: 'flex-end', // Align to right like avatar
    })
    
    // Create shadow root for chat (so it has access to Tailwind styles)
    const chatShadow = chatContainer.attachShadow({ mode: 'open' })
    const reactMountPoint = document.createElement('div')
    reactMountPoint.id = 'yumi-react-root'
    Object.assign(reactMountPoint.style, {
      // No positioning - let it be in normal flow within shadow DOM
      pointerEvents: 'auto'
    })
    chatShadow.appendChild(reactMountPoint)
    
    // Inject Tailwind CSS into chat shadow DOM as well
    try {
      const cssUrl = chrome.runtime.getURL('style.css')
      const cssResponse = await fetch(cssUrl).catch(() => null)
      if (cssResponse?.ok) {
        const cssText = await cssResponse.text()
        const chatStyleTag = document.createElement('style')
        chatStyleTag.textContent = cssText
        chatShadow.appendChild(chatStyleTag)
        log.log('[OK] Tailwind CSS injected into chat shadow DOM')
      }
    } catch (err) {
      log.warn('[WARN] Failed to load chat CSS:', err)
    }
    
    // Inject custom animations into chat shadow DOM
    const chatCustomStyle = document.createElement('style')
    chatCustomStyle.textContent = customStyle.textContent
    chatShadow.appendChild(chatCustomStyle)
    
    // Prepend to wrapper so chat appears first (above avatar in column)
    container.insertBefore(chatContainer, avatarContainer)
    
    // Get chat button from panel inside shadow DOM
    const chatToggleBtn = shadowRoot.getElementById('yumi-chat-toggle') as HTMLButtonElement
    
    // Mount React (after ensuring stores are hydrated)
    setTimeout(async () => {
      try {
        log.log('Pre-hydrating stores...')
        
        // IMPORTANT: Import stores BEFORE React components to ensure .persist is attached
        const { usePersonalityStore: personalityStore } = await import('../lib/stores/personality.store')
        const { useSettingsStore: settingsStore } = await import('../lib/stores/settings.store')

        // Explicitly hydrate all persisted stores before first render
        // rehydrate() resolves only after chrome.storage.local.get completes
        await Promise.all([
          personalityStore.persist.rehydrate(),
          settingsStore.persist.rehydrate(),
        ])

        // Verify stores are actually ready
        log.log('[OK] Stores hydrated')
        log.log('Personality hydrated?', personalityStore.persist.hasHydrated())
        log.log('Settings hydrated?', settingsStore.persist.hasHydrated())
        log.log('Personality state:', personalityStore.getState())
        log.log('Settings state:', settingsStore.getState())

        // Runtime assertion: Verify React singleton (should always be true with dedupe)
        const ReactTest1 = await import('react')
        const ReactTest2 = await import('react')
        const isSingleton = ReactTest1 === ReactTest2
        log.log('React singleton check:', isSingleton, 'version:', ReactTest1.version)
        if (!isSingleton) {
          log.error('[ERROR] CRITICAL: Multiple React instances detected!')
        }
        
        // Now import components - they will use their own static React imports
        // DO NOT import React separately here - let component graph own the single import
        const React = await import('react')
        const ReactDOM = await import('react-dom/client')
        const { ChatOverlay } = await import('./ChatOverlay')
        const { ErrorBoundary } = await import('./components/ErrorBoundary')
        
        const root = ReactDOM.createRoot(reactMountPoint)
        
        // Pass button reference and callback to React, wrapped in error boundary
        // No HydrationGate needed - stores are already hydrated via await rehydrate()
        // Use createElement from the same React instance the components imported
        root.render(
          React.createElement(ErrorBoundary, null,
            React.createElement(ChatOverlay, {
              chatButton: chatToggleBtn,
              onToggle: (isOpen: boolean) => {
                if (isOpen) {
                  chatToggleBtn.style.background = '#8B5CF6'
                  chatToggleBtn.style.boxShadow = '0 0 20px rgba(139, 92, 246, 0.5)'
                  chatToggleBtn.classList.add('active')
                } else {
                  chatToggleBtn.style.background = 'rgba(255, 255, 255, 0.1)'
                  chatToggleBtn.style.boxShadow = 'none'
                  chatToggleBtn.classList.remove('active')
                }
              }
            })
          )
        )
        
        log.log('[OK] React chat overlay mounted in shadow DOM')
      } catch (err) {
        log.error('[ERROR] Failed to mount React chat overlay:', err)
      }
    }, 0)
    // === END PHASE 1 ===

  } catch (e: any) {
    log.error('Failed to initialize overlay:', e)
    // Clean up on error
    destroyOverlay()
  } finally {
    isInitializing = false
  }
}

function destroyOverlay() {
  // Animate exit before cleanup
  if (avatarContainer && avatarContainer.style) {
    avatarContainer.style.opacity = '0'
    avatarContainer.style.transform = 'scale(0.8)'
    avatarContainer.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
  }

  // Wait for animation to complete before cleanup
  trackTimeout(() => {
    model?.destroy()
    app?.destroy(true)
    if (container?.isConnected) container.remove()
    container = null
    app = null
    model = null
    avatarContainer = null
  }, 300)

  // Clear all tracked timers to prevent memory leaks
  clearAllTimers()

  // Prevent further interactions during exit
  if (container) {
    container.style.pointerEvents = 'none'
  }

  // Lip sync cleanup handled by pixi-live2d-display-lipsyncpatch
  log.log('[OK] Overlay destroyed')
}

/**
 * Lightweight config update without remounting (for scale/position changes)
 * Returns true if update succeeded, false if full remount needed
 */
export function updateOverlayConfig(cfg: Partial<OverlayConfig>): boolean {
  // Guard: overlay must exist
  if (!container || !model || !app) {
    log.log('updateOverlayConfig: No overlay to update')
    return false
  }

  log.log('Updating config (no remount):', cfg)
  
  // Update scale in-place (modify PIXI sprite scale AND container size)
  if (cfg.scale !== undefined || cfg.modelOffsetX !== undefined || cfg.modelOffsetY !== undefined || cfg.modelScaleMultiplier !== undefined) {
    const userScale = cfg.scale ?? (avatarContainer ? avatarContainer.offsetWidth / BASE_WIDTH : 1)
    const baseFitScale = (model as any).__yumiBaseFitScale ?? 1 // Fallback if not set
    const modelOffsetX = cfg.modelOffsetX ?? 0
    const modelOffsetY = cfg.modelOffsetY ?? 0
    const modelScaleMultiplier = cfg.modelScaleMultiplier ?? 1.0
    
    // Step 1: Calculate new container size
    const containerWidth = Math.round(BASE_WIDTH * userScale)
    const containerHeight = Math.round(BASE_HEIGHT * userScale)
    
    // Step 2: Update container DOM size (only if scale changed)
    if (cfg.scale !== undefined) {
      avatarContainer!.style.width = `${containerWidth}px`
      avatarContainer!.style.height = `${containerHeight}px`
      
      // Step 3: Resize PIXI renderer
      app.renderer.resize(containerWidth, containerHeight)
    }
    
    // Step 4: Apply scale with model multiplier
    const finalScale = baseFitScale * userScale * modelScaleMultiplier
    model.scale?.set?.(finalScale)
    
    // Step 5: Update stored current scale (for ticker breathing animation)
    ;(model as any).__yumiCurrentScale = finalScale
    
    // Step 6: Re-position model with custom offsets
    model.position.x = containerWidth / 2 + modelOffsetX
    model.position.y = containerHeight - 10 + modelOffsetY
    
    // Step 7: Update stored base positions (for ticker animation)
    ;(model as any).__yumiBaseX = model.position.x
    ;(model as any).__yumiBaseY = model.position.y
    
    // Step 8: Force render update
    app.render()
    
    log.log('[OK] Model updated:', {
      scale: finalScale.toFixed(3),
      offsetX: modelOffsetX,
      offsetY: modelOffsetY,
      multiplier: modelScaleMultiplier.toFixed(2)
    })
  }

  // Update position in-place (just modify DOM style)
  if (cfg.position !== undefined) {
    positionContainer(cfg.position)
    log.log('[OK] Position updated:', cfg.position)
  }
  
  return true
}

// Expose API for content script to control overlay directly
export function mountOverlay(cfg: OverlayConfig) {
  log.log('mountOverlay called with:', cfg)
  // Destroy existing overlay before creating new one (handles model URL changes)
  if (container) {
    log.log('Destroying existing overlay before remounting')
    destroyOverlay()
  }
  createOverlay(cfg)
}

export function unmountOverlay() {
  destroyOverlay()
}

// Bus listener removed - lip sync handled by inline audio analysis in connectAndPlayAudio()

// Audio analysis state for lip sync
let lipSyncAudioContext: AudioContext | null = null
let lipSyncAnalyser: AnalyserNode | null = null
let lipSyncSource: MediaElementAudioSourceNode | null = null
let lipSyncAnimationFrame: number | null = null

// Streaming lip sync state (for ElevenLabs streaming TTS)
let streamingLipSyncFrame: number | null = null

/**
 * Connect audio element to lip sync and start playback.
 * Analyzes audio volume and sets ParamMouthOpenY directly on the model.
 */
export async function connectAndPlayAudio(audio: HTMLAudioElement, voiceId: string): Promise<void> {
  log.log('[MSG] connectAndPlayAudio called, voice:', voiceId)

  if (!model) {
    log.warn('Model not ready, falling back to direct playback')
    await audio.play()
    return
  }

  try {
    // Initialize AudioContext if needed
    if (!lipSyncAudioContext || lipSyncAudioContext.state === 'closed') {
      lipSyncAudioContext = new AudioContext()
      log.log('[OK] AudioContext created for lip sync')
    }

    // Resume if suspended (required after user gesture)
    if (lipSyncAudioContext.state === 'suspended') {
      await lipSyncAudioContext.resume()
    }

    // Guard against multiple simultaneous audio sources
    if (lipSyncSource) {
      log.warn('Audio source already connected, cleaning up first')
      if (lipSyncAnimationFrame) {
        cancelAnimationFrame(lipSyncAnimationFrame)
        lipSyncAnimationFrame = null
      }
      lipSyncSource = null
    }

    // Create analyser node
    lipSyncAnalyser = lipSyncAudioContext.createAnalyser()
    lipSyncAnalyser.fftSize = 256
    lipSyncAnalyser.smoothingTimeConstant = 0.5

    // Connect audio element to analyser
    lipSyncSource = lipSyncAudioContext.createMediaElementSource(audio)
    lipSyncSource.connect(lipSyncAnalyser)
    lipSyncAnalyser.connect(lipSyncAudioContext.destination)

    log.log('[OK] Audio connected to analyser')

    // Data buffer for frequency analysis
    const dataArray = new Uint8Array(lipSyncAnalyser.frequencyBinCount)

    // Animation loop for lip sync
    const updateLipSync = () => {
      if (!lipSyncAnalyser || !model?.internalModel?.coreModel) {
        lipSyncAnimationFrame = null
        return
      }

      // Get frequency data
      lipSyncAnalyser.getByteFrequencyData(dataArray)

      // Calculate volume from speech frequencies (roughly 100Hz - 4000Hz)
      // With 256 FFT size and 44100Hz sample rate, each bin is ~172Hz
      // Bins 1-23 cover approximately 172Hz to 3956Hz (speech range)
      let sum = 0
      const speechStart = 1
      const speechEnd = Math.min(24, dataArray.length)
      for (let i = speechStart; i < speechEnd; i++) {
        sum += dataArray[i]
      }
      const avgVolume = sum / (speechEnd - speechStart)

      // Normalize to 0-1 range with threshold and scaling
      const threshold = 15
      const scale = 2.5
      let mouthOpen = Math.max(0, (avgVolume - threshold) / (255 - threshold)) * scale
      mouthOpen = Math.min(1.0, mouthOpen)

      // Store mouth value - will be applied in beforeModelUpdate hook
      lipSyncMouthValue = mouthOpen

      // Continue animation loop
      lipSyncAnimationFrame = requestAnimationFrame(updateLipSync)
    }

    // Start animation loop
    lipSyncAnimationFrame = requestAnimationFrame(updateLipSync)

    // Cleanup when audio ends
    const cleanup = () => {
      log.log('Audio ended, cleaning up lip sync')
      if (lipSyncAnimationFrame) {
        cancelAnimationFrame(lipSyncAnimationFrame)
        lipSyncAnimationFrame = null
      }
      // Reset mouth to closed (will be applied in beforeModelUpdate)
      lipSyncMouthValue = 0
    }

    audio.addEventListener('ended', cleanup, { once: true })
    audio.addEventListener('error', cleanup, { once: true })

    // Start playback
    audio.muted = false
    audio.volume = 1.0
    await audio.play()
    log.log('[OK] Audio playback started with lip sync')

  } catch (err) {
    log.error('Failed to connect audio for lip sync:', err)
    // Fallback to direct playback
    await audio.play()
  }
}

/**
 * Connect an external AnalyserNode for streaming TTS lip sync.
 * Used by ElevenLabs streaming TTS to analyze audio chunks in real-time.
 *
 * @param analyser - AnalyserNode from StreamingAudioPlayer
 * @returns Cleanup function to stop lip sync and reset mouth
 */
export function connectStreamingAnalyser(analyser: AnalyserNode): () => void {
  log.log('Connecting streaming analyser for lip sync')

  if (!model?.internalModel?.coreModel) {
    log.warn('Model not ready for streaming lip sync')
    return () => {}
  }

  // Stop any existing streaming lip sync
  if (streamingLipSyncFrame) {
    cancelAnimationFrame(streamingLipSyncFrame)
    streamingLipSyncFrame = null
  }

  // Data buffer for frequency analysis
  const dataArray = new Uint8Array(analyser.frequencyBinCount)

  /** Animation loop for streaming lip sync */
  let lipSyncDebugCounter = 0
  const updateLipSync = () => {
    if (!model?.internalModel?.coreModel) {
      streamingLipSyncFrame = null
      lipSyncMouthValue = 0
      return
    }

    /** Get frequency data from external analyser */
    analyser.getByteFrequencyData(dataArray)

    /**
     * Calculate volume from speech frequencies (same logic as connectAndPlayAudio)
     * Bins 1-23 cover approximately 172Hz to 3956Hz (speech range)
     */
    let sum = 0
    const speechStart = 1
    const speechEnd = Math.min(24, dataArray.length)
    for (let i = speechStart; i < speechEnd; i++) {
      sum += dataArray[i]
    }
    const avgVolume = sum / (speechEnd - speechStart)

    /** Normalize to 0-1 range with threshold and scaling */
    const threshold = 15
    const scale = 2.5
    let mouthOpen = Math.max(0, (avgVolume - threshold) / (255 - threshold)) * scale
    mouthOpen = Math.min(1.0, mouthOpen)

    /** Store mouth value - will be applied in afterMotionUpdate hook */
    lipSyncMouthValue = mouthOpen

    /** Debug logging every 60 frames */
    lipSyncDebugCounter++
    if (lipSyncDebugCounter % 60 === 1) {
      console.log(`[LipSync Loop] avgVolume: ${avgVolume.toFixed(1)}, mouthOpen: ${mouthOpen.toFixed(2)}`)
    }

    /** Continue animation loop */
    streamingLipSyncFrame = requestAnimationFrame(updateLipSync)
  }

  // Start animation loop
  streamingLipSyncFrame = requestAnimationFrame(updateLipSync)
  log.log('Streaming lip sync started')

  // Return cleanup function
  return () => {
    log.log('Cleaning up streaming lip sync')
    if (streamingLipSyncFrame) {
      cancelAnimationFrame(streamingLipSyncFrame)
      streamingLipSyncFrame = null
    }
    // Reset mouth to closed
    lipSyncMouthValue = 0
  }
}

// Expose function globally for cross-module access
if (typeof window !== 'undefined') {
  (window as any).__yumiConnectAndPlayAudio = connectAndPlayAudio
  ;(window as any).__yumiConnectStreamingAnalyser = connectStreamingAnalyser

  // Expression API using native pixi-live2d-display expressions (.exp3.json files)
  ;(window as any).__yumiExpression = {
    /**
     * Set expression by name (e.g., 'happy', 'sad', 'neutral')
     * Note: model.expression() returns a Promise - we await it for proper loading
     */
    set: async (name: string) => {
      if (model) {
        try {
          await model.expression(name)
          log.log(`Native expression set: ${name}`)
        } catch (err) {
          log.error(`Failed to set expression ${name}:`, err)
        }
      }
    },
    // Get current expression name
    get: () => {
      if (model?.internalModel?.motionManager?.expressionManager) {
        return model.internalModel.motionManager.expressionManager.currentExpressionName
      }
      return null
    },
    // List available expressions
    list: () => {
      if (model?.internalModel?.motionManager?.expressionManager) {
        const mgr = model.internalModel.motionManager.expressionManager
        return mgr.definitions?.map((d: any) => d.Name || d.name) || []
      }
      return []
    },
    /**
     * Reset to neutral expression
     * Note: model.expression() returns a Promise - we await it for proper loading
     */
    reset: async () => {
      if (model) {
        try {
          await model.expression('neutral')
          log.log('Expression reset to neutral')
        } catch (err) {
          log.error('Failed to reset expression:', err)
        }
      }
    }
  }

  // Debug functions - only available in development builds
  if (__DEV__) {
    // Debug function to set raw parameters (for debug panel)
    // These values are applied every frame in beforeModelUpdate
    ;(window as any).__yumiDebugSetParams = (params: Record<string, number>) => {
      if (!model?.internalModel?.coreModel) {
        log.warn('[DEBUG] Model not ready')
        return
      }
      debugPanelActive = true
      debugPanelValues = { ...params }
    }

    // Disable debug panel mode (return to normal expression controller)
    ;(window as any).__yumiDebugDisable = () => {
      debugPanelActive = false
      debugPanelValues = {}
    }

    // Debug function to get current parameter value
    ;(window as any).__yumiDebugGetParam = (paramId: string): number | null => {
      if (!model?.internalModel?.coreModel) return null
      try {
        const index = model.internalModel.coreModel.getParameterIndex(paramId)
        if (index >= 0) {
          return model.internalModel.coreModel.getParameterValue(index)
        }
      } catch (e) {
        // Parameter might not exist
      }
      return null
    }

    // Debug function to dump all expression-related parameter values
    ;(window as any).__yumiDebugDumpParams = (): Record<string, number> => {
      if (!model?.internalModel?.coreModel) {
        log.warn('[DEBUG] Model not ready')
        return {}
      }
      const params = [
        'ParamMouthForm', 'ParamMouthOpenY',
        'ParamEyeLOpen', 'ParamEyeROpen',
        'ParamEyeLSmile', 'ParamEyeRSmile',
        'ParamBrowLY', 'ParamBrowRY',
        'ParamBrowLForm', 'ParamBrowRForm',
        'ParamBrowLAngle', 'ParamBrowRAngle',
        'ParamCheek',
        'ParamAngleX', 'ParamAngleY', 'ParamAngleZ'
      ]
      const result: Record<string, number> = {}
      const coreModel = model.internalModel.coreModel
      for (const paramId of params) {
        try {
          const index = coreModel.getParameterIndex(paramId)
          if (index >= 0) {
            result[paramId] = coreModel.getParameterValue(index)
          }
        } catch (e) {
          // Skip
        }
      }
      log.log('Model parameters:', result)
      return result
    }
  }
}

log.log('[OK] Global API functions registered')

// Optional auto-mount if flag is set on window for quick dev
if ((window as any).__YUMI_OVERLAY_AUTO__) {
  createOverlay({ modelUrl: '/companions/yumi/model/model.model3.json', scale: 1, position: 'bottom-right' })
}
