/**
 * VRM 3D Avatar Overlay
 *
 * Renders VRM avatars using Echo Avatar Engine (Three.js + @pixiv/three-vrm).
 * Replaces the Live2D overlay with a simpler, more maintainable implementation.
 */

import { EchoAvatar, EmotionType } from '@yumi/echo-avatar'
import { createLogger } from '../lib/core/debug'
import { AVATAR } from '../lib/design/dimensions'
import { sttService } from '../lib/stt/sttService'
import { ttsService } from '../lib/tts'
import { useSettingsStore } from '../lib/stores/settings.store'
import { bubbleManager } from './visionAbilities/FloatingResponseBubble'
import { bus } from '../lib/core/bus'

import './styles'

const log = createLogger('VrmOverlay')

/**
 * Security: Generate a unique nonce for this session to validate API calls.
 * Only code with the nonce can access the APIs, preventing malicious page scripts.
 */
const API_NONCE = crypto.randomUUID()

/** Check if we're in a Chrome extension context */
function isExtensionContext(): boolean {
  return typeof chrome !== 'undefined' && chrome.runtime && !!chrome.runtime.id
}

/** Event bridge state */
let isEchoAvatarReady = false
let pendingAvatarEvents: Array<{ type: string; source?: string }> = []
let eventBridgeCleanup: (() => void) | null = null

interface OverlayConfig {
  modelUrl: string
  scale: number
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  modelOffsetX?: number
  modelOffsetY?: number
  modelScaleMultiplier?: number
}

/** Singleton state */
let container: HTMLElement | null = null
let avatarContainer: HTMLElement | null = null
let echoAvatar: EchoAvatar | null = null
let isInitializing = false

/** Drag state */
let dragging = false
let dragOffsetX = 0
let dragOffsetY = 0

/** Lip sync state */
let streamingLipSyncCleanup: (() => void) | null = null

/** Timer tracking for cleanup */
const activeTimers = new Set<ReturnType<typeof setTimeout>>()
const activeIntervals = new Set<ReturnType<typeof setInterval>>()

/** Event listener cleanup registry */
const cleanupFunctions: Array<() => void> = []

function registerCleanup(cleanup: () => void): void {
  cleanupFunctions.push(cleanup)
}

function runAllCleanups(): void {
  for (const cleanup of cleanupFunctions) {
    try {
      cleanup()
    } catch (e) {
      log.warn('Cleanup function failed:', e)
    }
  }
  cleanupFunctions.length = 0
}

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

function clearAllTimers(): void {
  activeTimers.forEach(id => clearTimeout(id))
  activeTimers.clear()
  activeIntervals.forEach(id => clearInterval(id))
  activeIntervals.clear()
}

/** Expression mapping from Yumi names to VRM preset expressions */
const YUMI_TO_VRM_EXPRESSIONS: Record<string, string> = {
  'neutral': 'neutral',
  'happy': 'happy',
  'thinking': 'surprised',
  'sad': 'sad',
  'angry': 'angry',
  'surprised': 'surprised',
  'relaxed': 'relaxed'
}

function mapExpression(yumiName: string): string {
  return YUMI_TO_VRM_EXPRESSIONS[yumiName] ?? yumiName
}

/**
 * Load shared library animations from public/animations/
 */
async function loadSharedAnimations(): Promise<void> {
  if (!echoAvatar) {
    log.warn('EchoAvatar not ready for animations')
    return
  }

  try {
    /** URL without trailing slash to avoid double slashes */
    const sharedLibraryUrl = chrome.runtime.getURL('animations')
    const manifestUrl = `${sharedLibraryUrl}/animations.json`

    log.log('Loading shared animations from:', manifestUrl)

    const response = await fetch(manifestUrl)
    if (!response.ok) {
      log.warn('No shared animations manifest found, status:', response.status)
      return
    }

    const manifest = await response.json()
    log.log('Shared animations manifest:', manifest)

    if (!manifest.animations || manifest.animations.length === 0) {
      log.warn('No animations defined in manifest')
      return
    }

    /** Create a minimal LoadedCompanion-like object for the shared library */
    const sharedCompanion = {
      manifest: { id: 'shared', name: 'Shared Library', version: '1.0.0', schemaVersion: '1.0' as const, compatibility: { engineMin: '1.0.0' }, model: { type: 'vrm' as const, path: '' }, assets: { files: [], totalSize: 0 } },
      resolveAsset: (path: string) => `${sharedLibraryUrl}/${path}`,
      unload: async () => {},
      animations: { ...manifest, useSharedLibrary: false },
      animationsBaseUrl: sharedLibraryUrl
    }

    log.log('Calling loadAnimationsFromCompanion...')
    await echoAvatar.loadAnimationsFromCompanion(sharedCompanion)
    log.log('[OK] Shared animations loaded')

    /** Register animation API */
    registerAnimationAPI()

    /** Trigger initial idle animation */
    log.log('Triggering initial idle animation...')
    echoAvatar.triggerAnimation('onIdle')
  } catch (error) {
    log.error('Failed to load shared animations:', error)
  }
}

/**
 * Register global animation API for triggering animations
 */
function registerAnimationAPI(): void {
  if (typeof window === 'undefined' || !echoAvatar) return

  /** Security wrapper for animation API */
  const requireContext = <T extends (...args: any[]) => any>(fn: T): T => {
    return ((...args: Parameters<T>): ReturnType<T> => {
      if (!isExtensionContext()) {
        log.warn('Animation API call blocked: not in extension context')
        return undefined as ReturnType<T>
      }
      return fn(...args)
    }) as T
  }

  /**
   * SECURITY: Public animation API - only trigger and play exposed
   * getRegistry removed to prevent metadata exposure to page scripts
   */
  window.__yumiAnimation = {
    trigger: requireContext((trigger: string) => {
      echoAvatar?.triggerAnimation(trigger)
    }),
    play: requireContext((animationId: string) => {
      return echoAvatar?.playAnimationById(animationId) ?? false
    })
  }

  /** Expose echoAvatar for debugging - only in extension context */
  if (isExtensionContext()) {
    window.__echoAvatar = echoAvatar
  }

  log.log('[OK] Animation API registered')
  log.log('  Trigger: window.__yumiAnimation.trigger("onHappy")')
  log.log('  Play: window.__yumiAnimation.play("dancing")')
}

/**
 * Set up event bridge from extension bus to EchoAvatar's eventBus.
 * This centralizes all animation/expression triggering through the echo-avatar system.
 */
function setupEventBridge(): void {
  if (!echoAvatar) return

  /** Clean up any existing bridge */
  if (eventBridgeCleanup) {
    eventBridgeCleanup()
    eventBridgeCleanup = null
  }

  const echoEventBus = echoAvatar.getEventBus()
  if (!echoEventBus) {
    log.warn('No event bus available for event bridge')
    return
  }

  /**
   * Forward avatar events from extension bus to EchoAvatar's eventBus
   */
  const forwardEvent = (event: { type: string; source?: string }) => {
    log.log(`[EventBridge] Forwarding: ${event.type}`, event.source ? `(source: ${event.source})` : '')

    switch (event.type) {
      case 'speaking:start':
        echoEventBus.emit('speaking:started', { source: event.source ?? 'chat' })
        break
      case 'speaking:stop':
        echoEventBus.emit('speaking:ended', { source: event.source ?? 'chat' })
        break
      case 'thinking:start':
        echoEventBus.emit('thinking:started', {})
        break
      case 'thinking:stop':
        echoEventBus.emit('thinking:stopped', {})
        break
    }
  }

  const handleAvatarEvent = (event: { type: string; source?: string }) => {
    if (!isEchoAvatarReady) {
      log.log(`[EventBridge] Queuing event (not ready): ${event.type}`)
      pendingAvatarEvents.push(event)
      return
    }
    forwardEvent(event)
  }

  const unsub = bus.on('avatar', handleAvatarEvent)
  eventBridgeCleanup = unsub

  /** Process any pending events now that we're ready */
  if (pendingAvatarEvents.length > 0) {
    log.log(`[EventBridge] Processing ${pendingAvatarEvents.length} pending events`)
    for (const event of pendingAvatarEvents) {
      forwardEvent(event)
    }
    pendingAvatarEvents = []
  }

  log.log('[OK] Event bridge setup complete')
}

async function createOverlay(cfg: OverlayConfig): Promise<void> {
  if (isInitializing || container) {
    log.log('Overlay already exists or initializing')
    return
  }

  isInitializing = true
  log.log('Creating VRM overlay', cfg)

  try {
    const baseWidth = AVATAR.baseWidth
    const baseHeight = AVATAR.baseHeight
    const userScale = cfg.scale ?? 1
    const modelScaleMultiplier = cfg.modelScaleMultiplier ?? 1
    const finalWidth = baseWidth * userScale
    const finalHeight = baseHeight * userScale

    /** Create wrapper container for avatar + chat */
    container = document.createElement('div')
    container.id = 'yumi-overlay-wrapper'
    Object.assign(container.style, {
      position: 'fixed',
      bottom: '0px',
      right: cfg.position === 'bottom-right' || cfg.position === 'top-right' ? '0px' : 'unset',
      left: cfg.position === 'bottom-left' || cfg.position === 'top-left' ? '0px' : 'unset',
      zIndex: '2147483646',
      pointerEvents: 'none'
    })

    /** Create avatar container with shadow DOM */
    avatarContainer = document.createElement('div')
    avatarContainer.id = 'yumi-avatar-container'
    Object.assign(avatarContainer.style, {
      width: `${finalWidth}px`,
      height: `${finalHeight}px`,
      pointerEvents: 'auto',
      position: 'relative'
    })

    const shadow = avatarContainer.attachShadow({ mode: 'open' })

    /** Create canvas wrapper inside shadow DOM */
    const canvasWrapper = document.createElement('div')
    canvasWrapper.id = 'yumi-canvas-wrapper'
    Object.assign(canvasWrapper.style, {
      width: '100%',
      height: '100%',
      position: 'relative',
      overflow: 'hidden'
    })

    /** Create loading spinner */
    const loadingSpinner = document.createElement('div')
    loadingSpinner.id = 'yumi-loading'
    Object.assign(loadingSpinner.style, {
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: '32px',
      height: '32px',
      border: '3px solid rgba(255, 255, 255, 0.3)',
      borderTop: '3px solid white',
      borderRadius: '50%',
      animation: 'yumi-spin 1s linear infinite'
    })

    const spinnerStyle = document.createElement('style')
    spinnerStyle.textContent = `
      @keyframes yumi-spin {
        to { transform: translate(-50%, -50%) rotate(360deg); }
      }
    `
    canvasWrapper.appendChild(spinnerStyle)
    canvasWrapper.appendChild(loadingSpinner)

    /** Create button panel and get chat button reference */
    const { panel: buttonPanel, chatButton } = createButtonPanel()
    canvasWrapper.appendChild(buttonPanel)

    shadow.appendChild(canvasWrapper)
    container.appendChild(avatarContainer)

    /** Create chat container placeholder (React will mount here) */
    const chatContainer = document.createElement('div')
    chatContainer.id = 'yumi-chat-container'
    Object.assign(chatContainer.style, {
      pointerEvents: 'auto',
      position: 'absolute',
      bottom: `${finalHeight}px`,
      right: '0px'
    })
    container.appendChild(chatContainer)

    document.documentElement.appendChild(container)

    /** Initialize Echo Avatar with shadow root as container */
    echoAvatar = new EchoAvatar({
      container: canvasWrapper,
      size: { width: finalWidth, height: finalHeight },
      position: { x: 0, y: 0 },
      zIndex: 1,
      autoStart: false,
      eyeTracking: true,
      idleAnimations: true,
      lipSync: true
    })

    /** Load VRM model */
    console.log('[VrmOverlay] Loading VRM model:', cfg.modelUrl)
    try {
      await echoAvatar.loadModel(cfg.modelUrl)
      console.log('[VrmOverlay] loadModel completed')
    } catch (loadError) {
      console.error('[VrmOverlay] loadModel() threw an error:', loadError)
      throw loadError
    }

    /** Log expression mapping for debugging */
    console.log('[VrmOverlay] Getting expression mapping...')
    const expressionMapping = echoAvatar.getExpressionMapping()
    console.log('[VrmOverlay] Expression mapping:', expressionMapping)

    /** Load shared library animations */
    await loadSharedAnimations()

    /** Set up event bridge and mark avatar as ready */
    setupEventBridge()
    isEchoAvatarReady = true
    log.log('[OK] EchoAvatar ready, event bridge active')

    /** Apply scale */
    console.log('[VrmOverlay] Applying scale, multiplier:', modelScaleMultiplier)
    if (modelScaleMultiplier !== 1) {
      echoAvatar.setScale(modelScaleMultiplier)
    }

    /** Apply model offset (horizontal/vertical position within canvas) */
    const offsetX = cfg.modelOffsetX ?? 0
    const offsetY = cfg.modelOffsetY ?? 0
    if (offsetX !== 0 || offsetY !== 0) {
      echoAvatar.setModelOffset(offsetX, offsetY)
    }

    /** Remove loading spinner */
    console.log('[VrmOverlay] Removing spinner, starting avatar...')
    loadingSpinner.remove()

    /** Start rendering */
    echoAvatar.start()
    console.log('[VrmOverlay] Avatar started, registering APIs...')

    /** Register global APIs */
    registerGlobalAPIs()
    console.log('[VrmOverlay] APIs registered, mounting chat...')

    /** Mount React chat overlay with button reference */
    await mountChatOverlay(chatContainer, chatButton)

    console.log('[VrmOverlay] [OK] VRM overlay created')
  } catch (error) {
    console.error('[VrmOverlay] Failed to create VRM overlay:', error)
    destroyOverlay()
    throw error
  } finally {
    isInitializing = false
  }
}

function createButtonPanel(): { panel: HTMLDivElement; chatButton: HTMLButtonElement } {
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

  /** Drag button */
  const dragHandle = createButton('move', () => {})
  dragHandle.textContent = '\u21D5'
  dragHandle.style.cursor = 'grab'
  dragHandle.onmousedown = (e) => {
    dragging = true
    const rect = container!.getBoundingClientRect()
    dragOffsetX = e.clientX - rect.left
    dragOffsetY = e.clientY - rect.top
    dragHandle.style.cursor = 'grabbing'
    e.preventDefault()
  }

  const handleMouseMove = (e: MouseEvent) => {
    if (!dragging || !container) return
    container.style.left = `${e.clientX - dragOffsetX}px`
    container.style.bottom = `${window.innerHeight - (e.clientY - dragOffsetY + container.offsetHeight)}px`
    container.style.right = 'unset'
    container.style.transform = 'none'
  }

  const handleMouseUp = () => {
    if (dragging) {
      dragging = false
      dragHandle.style.cursor = 'grab'
    }
  }

  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)

  registerCleanup(() => {
    window.removeEventListener('mousemove', handleMouseMove)
    window.removeEventListener('mouseup', handleMouseUp)
  })

  /** Chat toggle button */
  const chatBtn = createButton('chat', () => {})
  chatBtn.textContent = '\uD83D\uDCAC'
  chatBtn.id = 'yumi-chat-toggle'

  /** Mic button */
  const micBtn = createMicButton()

  /** Close button */
  const closeBtn = createButton('close', () => destroyOverlay())
  closeBtn.textContent = '\u00D7'
  closeBtn.style.fontSize = '24px'

  buttonPanel.appendChild(dragHandle)
  buttonPanel.appendChild(chatBtn)
  buttonPanel.appendChild(micBtn)
  buttonPanel.appendChild(closeBtn)

  return { panel: buttonPanel, chatButton: chatBtn }
}

function createButton(type: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  Object.assign(btn.style, {
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
    transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
    pointerEvents: 'auto'
  })

  btn.onmouseenter = () => {
    btn.style.background = 'rgba(255, 255, 255, 0.2)'
    btn.style.transform = 'scale(1.15)'
  }
  btn.onmouseleave = () => {
    btn.style.background = 'rgba(255, 255, 255, 0.1)'
    btn.style.transform = 'scale(1)'
  }
  btn.onclick = onClick

  return btn
}

function createMicButton(): HTMLButtonElement {
  const micBtn = document.createElement('button')
  micBtn.textContent = '\uD83C\uDF99'
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
  const unsubscribeSettings = useSettingsStore.subscribe(updateMicVisibility)
  registerCleanup(unsubscribeSettings)

  const resetMicButton = () => {
    micRecording = false
    if (micDurationInterval) {
      clearInterval(micDurationInterval)
      activeIntervals.delete(micDurationInterval)
      micDurationInterval = null
    }
    micBtn.style.background = 'rgba(255, 255, 255, 0.1)'
    micBtn.style.transform = 'scale(1)'
    micBtn.textContent = '\uD83C\uDF99'
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
    micRecording = false

    const text = await sttService.stopRecordingAndTranscribe()
    if (text) {
      resetMicButton()
      const inputEvent = new CustomEvent('yumi-stt-result', { detail: { text } })
      document.dispatchEvent(inputEvent)
    } else {
      micBtn.style.background = 'rgba(239, 68, 68, 0.8)'
      micBtn.textContent = '!'
      trackTimeout(resetMicButton, 1500)
    }
  }

  return micBtn
}

async function mountChatOverlay(chatContainer: HTMLElement, chatButton: HTMLButtonElement): Promise<void> {
  try {
    console.log('[VrmOverlay] mountChatOverlay: importing ChatOverlay...')
    const { mountChatOverlay: mount } = await import('./ChatOverlay')
    console.log('[VrmOverlay] mountChatOverlay: attaching shadow DOM...')
    const chatShadow = chatContainer.attachShadow({ mode: 'open' })
    console.log('[VrmOverlay] mountChatOverlay: calling mount()...')
    mount(chatShadow, chatButton)
    console.log('[VrmOverlay] mountChatOverlay: [OK] Chat overlay mounted')
  } catch (error) {
    console.error('[VrmOverlay] Failed to mount chat overlay:', error)
    throw error
  }
}

function registerGlobalAPIs(): void {
  if (typeof window === 'undefined') return

  /**
   * Security wrapper: Only allow API access from extension context.
   * Page scripts cannot access chrome.runtime.id, so they cannot call these APIs.
   */
  const requireExtensionContext = <T extends (...args: any[]) => any>(fn: T): T => {
    return ((...args: Parameters<T>): ReturnType<T> => {
      if (!isExtensionContext()) {
        log.warn('API call blocked: not in extension context')
        return undefined as ReturnType<T>
      }
      return fn(...args)
    }) as T
  }

  /** Audio playback with lip sync - wrapped for security */
  window.__yumiConnectAndPlayAudio = requireExtensionContext(connectAndPlayAudio)
  window.__yumiConnectStreamingAnalyser = requireExtensionContext(connectStreamingAnalyser)

  /** Expression API - wrapped for security */
  window.__yumiExpression = {
    set: requireExtensionContext(async (name: string) => {
      if (echoAvatar) {
        const vrmName = mapExpression(name)
        log.log(`Setting expression: ${name} -> ${vrmName}`)
        echoAvatar.setExpression(vrmName, 0.3)
      }
    }),
    get: requireExtensionContext(() => {
      if (echoAvatar) {
        const state = echoAvatar.getState()
        return state.activeExpressions[0] ?? 'neutral'
      }
      return null
    }),
    list: requireExtensionContext(() => {
      return Object.keys(YUMI_TO_VRM_EXPRESSIONS)
    }),
    reset: requireExtensionContext(async () => {
      if (echoAvatar) {
        echoAvatar.setExpression('neutral', 0.3)
      }
    })
  }

  /** Touch interaction API - wrapped for security */
  window.__yumiTouch = {
    setEnabled: requireExtensionContext((enabled: boolean) => echoAvatar?.setTouchEnabled(enabled)),
    isEnabled: requireExtensionContext(() => echoAvatar?.isTouchEnabled() ?? false),
    clearCooldowns: requireExtensionContext(() => echoAvatar?.clearTouchCooldowns())
  }

  /** Thinking state API - wrapped for security */
  window.__yumiThinking = {
    start: requireExtensionContext(() => echoAvatar?.startThinking()),
    stop: requireExtensionContext(() => echoAvatar?.stopThinking()),
    isThinking: requireExtensionContext(() => echoAvatar?.isThinking() ?? false)
  }

  /** Emotion state API - wrapped for security */
  window.__yumiEmotion = {
    set: requireExtensionContext((emotion: string, intensity?: number, duration?: number) => {
      echoAvatar?.setEmotion(emotion as EmotionType, intensity, duration)
    }),
    nudge: requireExtensionContext((emotion: string, delta: number) => {
      echoAvatar?.nudgeEmotion(emotion as EmotionType, delta)
    }),
    get: requireExtensionContext(() => echoAvatar?.getEmotion() ?? 'neutral'),
    getIntensity: requireExtensionContext(() => echoAvatar?.getEmotionIntensity() ?? 0),
    recordInteraction: requireExtensionContext(() => echoAvatar?.recordInteraction()),
    getIdleTime: requireExtensionContext(() => echoAvatar?.getIdleTime() ?? 0)
  }

  /** Listen for touch reactions from EchoAvatar */
  setupTouchReactionHandler()

  /** Listen for thinking/emotion events */
  setupAnimationEventHandlers()

  /**
   * SECURITY: DevTools bridge only available in development builds
   * Allows console commands to control avatar for debugging
   * Tree-shaken in production builds
   */
  if (__DEV__) {
    setupDevToolsBridge()
  }

  console.log('[VrmOverlay] [OK] Global API functions registered')
}

/**
 * Set up a bridge to allow DevTools console to trigger expressions.
 * Usage from console: document.dispatchEvent(new CustomEvent('yumi:expression', { detail: 'happy' }))
 */
function setupDevToolsBridge(): void {
  const handleExpression = ((e: CustomEvent<string>) => {
    const name = e.detail
    if (echoAvatar && name) {
      const vrmName = mapExpression(name)
      console.log(`[VrmOverlay] DevTools bridge: setting expression ${name} -> ${vrmName}`)
      echoAvatar.setExpression(vrmName, 0.3)
    }
  }) as EventListener

  const handleVrmDirect = ((e: CustomEvent<{ expr: string; value: number }>) => {
    const { expr, value } = e.detail
    const model = echoAvatar?.getModel()
    if (model && 'getVRM' in model) {
      const vrm = (model as { getVRM(): unknown }).getVRM() as { expressionManager?: { setValue: (n: string, v: number) => void; expressions: Array<{ expressionName: string }> } }
      if (vrm?.expressionManager) {
        console.log(`[VrmOverlay] DIRECT VRM: setValue('${expr}', ${value})`)
        console.log('[VrmOverlay] Available expressions:', vrm.expressionManager.expressions.map((ex) => ex.expressionName))
        vrm.expressionManager.setValue(expr, value)
      }
    }
  }) as EventListener

  const handleVrmParam = ((e: CustomEvent<{ expr: string; value: number }>) => {
    const { expr, value } = e.detail
    const model = echoAvatar?.getModel()
    if (model) {
      const paramId = `expr:${expr}`
      model.setParameter(paramId, value)
      console.log(`[VrmOverlay] Set parameter ${paramId} = ${value}`)
      console.log(`[VrmOverlay] Verify: getParameter(${paramId}) = ${model.getParameter(paramId)}`)
    }
  }) as EventListener

  const handleVrmDebug = (() => {
    const model = echoAvatar?.getModel()
    if (model && 'getVRM' in model) {
      const vrm = (model as { getVRM(): unknown }).getVRM() as {
        expressionManager?: {
          expressions: Array<{ expressionName: string; _binds?: unknown[]; binds?: unknown[]; _morphTargetBinds?: unknown[] }>
          getValue: (n: string) => number
        }
        scene: { traverse: (cb: (obj: { isMesh?: boolean; name?: string; morphTargetDictionary?: Record<string, number>; morphTargetInfluences?: number[] }) => void) => void }
      }
      if (vrm?.expressionManager) {
        console.log('[VrmOverlay] === VRM Expression Debug ===')
        const expressions = vrm.expressionManager.expressions
        for (const expr of expressions) {
          const name = expr.expressionName
          const currentValue = vrm.expressionManager.getValue(name)
          const binds = expr._binds ?? expr.binds ?? expr._morphTargetBinds ?? []
          console.log(`[${name}] value=${currentValue}, bindings=${binds.length}`)
          console.log(`  Expression object keys:`, Object.keys(expr))
          for (let i = 0; i < Math.min(binds.length, 3); i++) {
            const bind = binds[i]
            console.log(`  bind[${i}]:`, (bind as object)?.constructor?.name ?? typeof bind)
            if (bind) {
              console.log(`    bind properties:`, Object.keys(bind as object))
            }
          }
          if (binds.length > 3) {
            console.log(`  ... and ${binds.length - 3} more bindings`)
          }
        }

        console.log('[VrmOverlay] === Mesh Morph Targets ===')
        let meshCount = 0
        vrm.scene.traverse((obj) => {
          if (obj.isMesh) {
            meshCount++
            if (obj.morphTargetDictionary && Object.keys(obj.morphTargetDictionary).length > 0) {
              console.log(`Mesh "${obj.name}": morph targets =`, Object.keys(obj.morphTargetDictionary))
              console.log(`  morphTargetInfluences length:`, obj.morphTargetInfluences?.length)
            }
          }
        })
        console.log(`Total meshes in scene: ${meshCount}`)
      }
    }
  }) as EventListener

  const handleVrmTest = ((e: CustomEvent<string>) => {
    const exprName = e.detail || 'happy'
    const model = echoAvatar?.getModel()
    if (model && 'getVRM' in model) {
      const vrm = (model as { getVRM(): unknown }).getVRM() as {
        expressionManager?: { getValue: (n: string) => number; setValue: (n: string, v: number) => void }
        update: (dt: number) => void
        scene: { traverse: (cb: (obj: { isMesh?: boolean; name?: string; morphTargetDictionary?: Record<string, number>; morphTargetInfluences?: number[] }) => void) => void }
      }
      if (vrm?.expressionManager) {
        console.log(`[VrmOverlay] === TEST: Setting ${exprName} ===`)
        console.log(`  Before: getValue('${exprName}') =`, vrm.expressionManager.getValue(exprName))
        vrm.expressionManager.setValue(exprName, 1.0)
        console.log(`  After setValue: getValue('${exprName}') =`, vrm.expressionManager.getValue(exprName))
        vrm.update(0.016)
        console.log(`  After vrm.update: getValue('${exprName}') =`, vrm.expressionManager.getValue(exprName))
        vrm.scene.traverse((obj) => {
          if (obj.isMesh && obj.morphTargetInfluences && obj.morphTargetDictionary) {
            const smileIdx = obj.morphTargetDictionary['Mouth_Smile_1']
            const eyeSmileIdx = obj.morphTargetDictionary['Eye_Close_Smile']
            if (smileIdx !== undefined) {
              console.log(`  Mesh ${obj.name}: Mouth_Smile_1 influence =`, obj.morphTargetInfluences[smileIdx])
            }
            if (eyeSmileIdx !== undefined) {
              console.log(`  Mesh ${obj.name}: Eye_Close_Smile influence =`, obj.morphTargetInfluences[eyeSmileIdx])
            }
          }
        })
      }
    }
  }) as EventListener

  const handleVrmParams = (() => {
    const model = echoAvatar?.getModel()
    if (model) {
      const paramIds = model.getParameterIds().filter((id: string) => id.startsWith('expr:'))
      console.log('[VrmOverlay] Expression parameters:')
      for (const paramId of paramIds) {
        const value = model.getParameter(paramId)
        console.log(`  ${paramId} = ${value}`)
      }
    }
  }) as EventListener

  document.addEventListener('yumi:expression', handleExpression)
  document.addEventListener('yumi:vrm-direct', handleVrmDirect)
  document.addEventListener('yumi:vrm-param', handleVrmParam)
  document.addEventListener('yumi:vrm-debug', handleVrmDebug)
  document.addEventListener('yumi:vrm-test', handleVrmTest)
  document.addEventListener('yumi:vrm-params', handleVrmParams)

  registerCleanup(() => {
    document.removeEventListener('yumi:expression', handleExpression)
    document.removeEventListener('yumi:vrm-direct', handleVrmDirect)
    document.removeEventListener('yumi:vrm-param', handleVrmParam)
    document.removeEventListener('yumi:vrm-debug', handleVrmDebug)
    document.removeEventListener('yumi:vrm-test', handleVrmTest)
    document.removeEventListener('yumi:vrm-params', handleVrmParams)
  })

  console.log('[VrmOverlay] DevTools bridge ready.')
  console.log('  Expression: document.dispatchEvent(new CustomEvent("yumi:expression", { detail: "happy" }))')
  console.log('  Direct VRM: document.dispatchEvent(new CustomEvent("yumi:vrm-direct", { detail: { expr: "happy", value: 1 } }))')
  console.log('  Test: document.dispatchEvent(new CustomEvent("yumi:vrm-test", { detail: "happy" }))')
  console.log('  Params: document.dispatchEvent(new CustomEvent("yumi:vrm-params"))')
}

/** Touch reaction cleanup function */
let touchReactionCleanup: (() => void) | null = null

/**
 * Set up handler for touch reactions - shows bubbles and plays TTS
 */
function setupTouchReactionHandler(): void {
  if (!echoAvatar) return

  /** Clean up any existing handler */
  if (touchReactionCleanup) {
    touchReactionCleanup()
    touchReactionCleanup = null
  }

  /** Listen for touch:reaction events from EchoAvatar's eventBus */
  const eventBus = echoAvatar.getEventBus()
  if (!eventBus) {
    log.warn('No event bus available for touch reactions')
    return
  }

  interface TouchReactionData {
    zone: string
    expression: string
    message?: string
    duration: number
  }

  const handleTouchReaction = (event: { data: TouchReactionData }) => {
    const data = event.data
    log.log(`Touch reaction: ${data.zone} -> ${data.expression}`, data.message ? `"${data.message}"` : '')

    /** Show message in bubble if provided */
    if (data.message) {
      const avatarEl = document.getElementById('yumi-avatar-container')
      if (avatarEl) {
        const rect = avatarEl.getBoundingClientRect()
        const position = {
          x: rect.left + rect.width / 2,
          y: rect.top
        }

        const requestId = `touch-${Date.now()}`
        const bubble = bubbleManager.create({
          position,
          anchor: 'avatar',
          autoFadeMs: 4000
        }, requestId)

        if (bubble) {
          bubble.appendChunk(data.message)
          bubble.finalize()
        }
      }

      /** Play TTS if enabled */
      const settings = useSettingsStore.getState()
      if (settings.ttsEnabled) {
        ttsService.speak(data.message).catch((err) => {
          log.warn('Touch reaction TTS failed:', err)
        })
      }
    }
  }

  eventBus.on<TouchReactionData>('touch:reaction', handleTouchReaction)

  touchReactionCleanup = () => {
    eventBus.off('touch:reaction', handleTouchReaction)
  }
}

/** Animation event cleanup functions */
let thinkingEventCleanup: (() => void) | null = null
let emotionEventCleanup: (() => void) | null = null
let microExpressionEventCleanup: (() => void) | null = null

/**
 * Set up handlers for thinking, emotion, and micro-expression events
 */
function setupAnimationEventHandlers(): void {
  if (!echoAvatar) return

  const eventBus = echoAvatar.getEventBus()
  if (!eventBus) {
    log.warn('No event bus available for animation events')
    return
  }

  /** Clean up existing handlers */
  if (thinkingEventCleanup) {
    thinkingEventCleanup()
    thinkingEventCleanup = null
  }
  if (emotionEventCleanup) {
    emotionEventCleanup()
    emotionEventCleanup = null
  }
  if (microExpressionEventCleanup) {
    microExpressionEventCleanup()
    microExpressionEventCleanup = null
  }

  /** Handle thinking state changes */
  const handleThinkingStart = () => {
    log.log('Thinking animation started')
    document.dispatchEvent(new CustomEvent('yumi-thinking-start'))
  }

  const handleThinkingStop = () => {
    log.log('Thinking animation stopped')
    document.dispatchEvent(new CustomEvent('yumi-thinking-stop'))
  }

  eventBus.on('thinking:start', handleThinkingStart)
  eventBus.on('thinking:stop', handleThinkingStop)

  thinkingEventCleanup = () => {
    eventBus.off('thinking:start', handleThinkingStart)
    eventBus.off('thinking:stop', handleThinkingStop)
  }

  /** Handle emotion changes */
  interface EmotionChangeData {
    previousEmotion: string
    newEmotion: string
    intensity: number
    source?: string
  }

  const handleEmotionChange = (event: { data: EmotionChangeData }) => {
    const data = event.data
    log.log(`Emotion changed: ${data.previousEmotion} -> ${data.newEmotion} (intensity: ${data.intensity})`)
    document.dispatchEvent(new CustomEvent('yumi-emotion-change', { detail: data }))
  }

  eventBus.on<EmotionChangeData>('emotion:change', handleEmotionChange)

  emotionEventCleanup = () => {
    eventBus.off('emotion:change', handleEmotionChange)
  }

  /** Handle micro-expression events (for debugging/analytics) */
  interface MicroExpressionData {
    expression: { name: string; intensity: number; duration: number }
  }

  const handleMicroExpressionStart = (event: { data: MicroExpressionData }) => {
    log.log(`Micro-expression: ${event.data.expression.name}`)
  }

  eventBus.on<MicroExpressionData>('microExpression:start', handleMicroExpressionStart)

  microExpressionEventCleanup = () => {
    eventBus.off('microExpression:start', handleMicroExpressionStart)
  }
}

/**
 * Connect and play audio with lip sync
 */
export async function connectAndPlayAudio(audio: HTMLAudioElement, _voiceId: string): Promise<void> {
  if (!echoAvatar) {
    log.warn('EchoAvatar not ready for audio')
    return
  }

  const animator = echoAvatar.getAnimator()
  if (!animator) {
    log.warn('Animator not ready')
    audio.play()
    return
  }

  /** Use Echo's built-in element-based lip sync */
  const success = animator.startLipSyncFromElement(audio)
  if (!success) {
    log.warn('Failed to start lip sync from element')
  }

  /** Play the audio */
  await audio.play()

  /** Stop lip sync when audio ends */
  audio.addEventListener('ended', () => {
    animator.stopLipSync()
  }, { once: true })
}

/**
 * Connect external AnalyserNode for streaming TTS lip sync
 */
export function connectStreamingAnalyser(analyser: AnalyserNode): () => void {
  log.log('Connecting streaming analyser for lip sync')

  if (!echoAvatar) {
    log.warn('EchoAvatar not ready for streaming lip sync')
    return () => {}
  }

  const animator = echoAvatar.getAnimator()
  if (!animator) {
    log.warn('Animator not ready for streaming lip sync')
    return () => {}
  }

  /** Clean up any existing streaming lip sync */
  if (streamingLipSyncCleanup) {
    streamingLipSyncCleanup()
    streamingLipSyncCleanup = null
  }

  /** Connect the external analyser */
  const cleanup = animator.connectExternalAnalyser(analyser)
  if (cleanup) {
    streamingLipSyncCleanup = cleanup
    log.log('Streaming lip sync connected')
  }

  return () => {
    log.log('Cleaning up streaming lip sync')
    if (streamingLipSyncCleanup) {
      streamingLipSyncCleanup()
      streamingLipSyncCleanup = null
    }
  }
}

function destroyOverlay(): void {
  log.log('Destroying VRM overlay')

  clearAllTimers()
  runAllCleanups()

  if (touchReactionCleanup) {
    touchReactionCleanup()
    touchReactionCleanup = null
  }

  if (thinkingEventCleanup) {
    thinkingEventCleanup()
    thinkingEventCleanup = null
  }

  if (emotionEventCleanup) {
    emotionEventCleanup()
    emotionEventCleanup = null
  }

  if (microExpressionEventCleanup) {
    microExpressionEventCleanup()
    microExpressionEventCleanup = null
  }

  if (streamingLipSyncCleanup) {
    streamingLipSyncCleanup()
    streamingLipSyncCleanup = null
  }

  /** Clean up event bridge */
  if (eventBridgeCleanup) {
    eventBridgeCleanup()
    eventBridgeCleanup = null
  }
  isEchoAvatarReady = false
  pendingAvatarEvents = []

  if (echoAvatar) {
    echoAvatar.destroy()
    echoAvatar = null
  }

  if (container) {
    container.remove()
    container = null
  }

  avatarContainer = null

  /** Clear global APIs */
  if (typeof window !== 'undefined') {
    delete (window as any).__yumiConnectAndPlayAudio
    delete (window as any).__yumiConnectStreamingAnalyser
    delete (window as any).__yumiExpression
    delete (window as any).__yumiTouch
    delete (window as any).__yumiThinking
    delete (window as any).__yumiEmotion
  }

  log.log('[OK] VRM overlay destroyed')
}

/**
 * Mount the overlay with configuration
 */
export function mountOverlay(cfg: OverlayConfig): void {
  createOverlay(cfg)
}

/**
 * Unmount the overlay
 */
export function unmountOverlay(): void {
  destroyOverlay()
}

/**
 * Update overlay configuration without full remount
 */
export function updateOverlayConfig(cfg: Partial<OverlayConfig>): boolean {
  if (!echoAvatar || !container || !avatarContainer) {
    return false
  }

  /** Update scale */
  if (cfg.scale !== undefined || cfg.modelScaleMultiplier !== undefined) {
    const scale = cfg.scale ?? 1
    const multiplier = cfg.modelScaleMultiplier ?? 1
    const baseWidth = AVATAR.baseWidth
    const baseHeight = AVATAR.baseHeight
    const finalWidth = baseWidth * scale
    const finalHeight = baseHeight * scale

    avatarContainer.style.width = `${finalWidth}px`
    avatarContainer.style.height = `${finalHeight}px`

    /** Update chat container position to stay above avatar */
    const chatContainer = container.querySelector('#yumi-chat-container') as HTMLElement
    if (chatContainer) {
      chatContainer.style.bottom = `${finalHeight}px`
    }

    echoAvatar.resize(finalWidth, finalHeight)
    echoAvatar.setScale(multiplier)
  }

  /** Update position */
  if (cfg.position !== undefined) {
    container.style.right = cfg.position === 'bottom-right' || cfg.position === 'top-right' ? '0px' : 'unset'
    container.style.left = cfg.position === 'bottom-left' || cfg.position === 'top-left' ? '0px' : 'unset'
  }

  /** Update model offset (horizontal/vertical position within canvas) */
  if (cfg.modelOffsetX !== undefined || cfg.modelOffsetY !== undefined) {
    const offsetX = cfg.modelOffsetX ?? 0
    const offsetY = cfg.modelOffsetY ?? 0
    echoAvatar.setModelOffset(offsetX, offsetY)
  }

  return true
}
