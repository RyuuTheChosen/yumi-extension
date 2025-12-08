import type { ImageUnderstandingConfig } from '../../lib/types/visionConfig'
import { imageToBase64, getAvatarPosition } from './utils'
import { sendPortMessage, getActivePort } from '../portManager'
import { getCurrentScope } from '../utils/scopes'
import { useScopedChatStore } from '../stores/scopedChat.store'
import type { Message } from '../utils/db'
import { bubbleManager, type VisionStage } from './FloatingResponseBubble'
import { createLogger } from '../../lib/core/debug'

const log = createLogger('ImageUnderstanding')

export class ImageUnderstanding {
  private config: ImageUnderstandingConfig
  private onClick = (e: MouseEvent) => this.handleClick(e)
  private onRuntimeMessage = (msg: any) => this.handleRuntimeMessage(msg)
  private processingImages = new Set<string>() // Prevent duplicate analysis
  private recentlyAnalyzed = new Map<string, number>() // Image URL -> timestamp
  private analysisCount = 0 // Track total analyses in session
  private lastAnalysisTime = 0 // Last API call timestamp
  private readonly COOLDOWN_MS = 5000 // 5 seconds per image
  private readonly MIN_INTERVAL_MS = 2000 // 2 seconds between any analyses
  private readonly MAX_PER_MINUTE = 10 // Max 10 analyses per minute
  private analysisTimestamps: number[] = [] // Sliding window for rate limiting

  constructor(config: ImageUnderstandingConfig) {
    this.config = config
    this.init()
  }

  private init() {
    if (!this.config.enabled) return
    document.addEventListener('click', this.onClick, true) // Capture phase
    chrome.runtime.onMessage.addListener(this.onRuntimeMessage)
    log.log('✅ Initialized')
  }

  private handleClick(e: MouseEvent) {
    const target = e.target as HTMLElement
    
    // Check if clicked on image with modifier key
    if (target.tagName === 'IMG' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      e.stopPropagation()
      this.analyzeImage(target as HTMLImageElement)
    }
  }

  private handleRuntimeMessage(msg: any) {
    // Context menu trigger from background
    if (msg.type === 'ANALYZE_IMAGE' && msg.payload?.imageUrl) {
      const img = document.querySelector(
        `img[src="${msg.payload.imageUrl}"]`
      ) as HTMLImageElement
      if (img) this.analyzeImage(img)
    }
  }

  async analyzeImage(img: HTMLImageElement) {
    const imgSrc = img.src
    const now = Date.now()
    
    // Prevent duplicate analysis
    if (this.processingImages.has(imgSrc)) {
      log.log('⏳ Already processing:', imgSrc)
      return
    }
    
    // Check cooldown for this specific image
    const lastAnalyzed = this.recentlyAnalyzed.get(imgSrc)
    if (lastAnalyzed && now - lastAnalyzed < this.COOLDOWN_MS) {
      const remaining = Math.ceil((this.COOLDOWN_MS - (now - lastAnalyzed)) / 1000)
      log.log(`⏱️ Cooldown: ${remaining}s remaining for this image`)
      this.showIndicator(img, 'cooldown', remaining)
      return
    }
    
    // Check minimum interval between ANY analyses
    if (now - this.lastAnalysisTime < this.MIN_INTERVAL_MS) {
      const remaining = Math.ceil((this.MIN_INTERVAL_MS - (now - this.lastAnalysisTime)) / 1000)
      log.log(`⏱️ Please wait ${remaining}s before next analysis`)
      this.showIndicator(img, 'cooldown', remaining)
      return
    }
    
    // Check rate limit (sliding window)
    this.analysisTimestamps = this.analysisTimestamps.filter(t => now - t < 60000)
    if (this.analysisTimestamps.length >= this.MAX_PER_MINUTE) {
      log.log('🚫 Rate limit: Max 10 analyses per minute')
      this.showIndicator(img, 'rate-limited', 0)
      return
    }
    
    // All checks passed - proceed with analysis
    this.processingImages.add(imgSrc)
    this.recentlyAnalyzed.set(imgSrc, now)
    this.lastAnalysisTime = now
    this.analysisTimestamps.push(now)
    this.analysisCount++
    
    log.log(`🔍 Analyzing image (${this.analysisCount} total, ${this.analysisTimestamps.length}/10 this minute):`, imgSrc)
    
    this.showIndicator(img, 'analyzing')
    
    try {
      // Convert to base64 with size limit
      const base64 = await imageToBase64(img, this.config.maxImageSize)
      
      // Extract context
      const surrounding = this.getImageContext(img)
      const altText = img.alt || 'none'
      const pageTitle = document.title
      const pageUrl = window.location.href
      
      // Get current scope and conversation history
      const currentScope = getCurrentScope()
      const store = useScopedChatStore.getState()
      const currentMessages = store.threads.get(currentScope.id) || []
      
      // Create message placeholders (user + assistant)
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: `[Image Analysis Request]\n\nAlt: "${altText}"\nContext: ${surrounding}`,
        ts: Date.now(),
        scopeId: currentScope.id,
        status: 'final',
      }
      
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        ts: Date.now(),
        scopeId: currentScope.id,
        status: 'streaming',
      }
      
      // Add messages to store
      const updatedMessages = [...currentMessages, userMessage, assistantMessage]
      const newThreads = new Map(store.threads)
      newThreads.set(currentScope.id, updatedMessages)
      
      useScopedChatStore.setState({
        threads: newThreads,
        streamingMessage: assistantMessage,
        status: 'streaming',
        error: null,
      })
      
      // Simple prompt - the detailed analysis framework is in the centralized prompts module
      const prompt = `Analyze this image from ${pageTitle || 'a webpage'}.`
      
      // Send via port WITHOUT history (vision + history = massive token usage)
      const requestId = crypto.randomUUID()
      
      // === Create floating bubble above avatar (only if chat is closed) ===
      const avatarPos = getAvatarPosition()
      const bubble = avatarPos ? bubbleManager.create({
        position: { x: avatarPos.x, y: avatarPos.y },
        anchor: 'avatar',
        autoFadeMs: 12000
      }, requestId) : null

      // Subscribe to port messages for this specific request
      const port = getActivePort()
      if (port && bubble) {
        const streamListener = (msg: any) => {
          if (msg.payload?.requestId !== requestId) return

          if (msg.type === 'VISION_STAGE') {
            const stage = msg.payload.stage as VisionStage
            bubble.setStage(stage, msg.payload.message)
          } else if (msg.type === 'STREAM_CHUNK') {
            bubble.appendChunk(msg.payload.delta)
          } else if (msg.type === 'STREAM_END') {
            bubble.finalize()
            port.onMessage.removeListener(streamListener)
            bubbleManager.remove(requestId)
          } else if (msg.type === 'STREAM_ERROR') {
            bubble.showError(msg.payload.error || 'An error occurred')
            port.onMessage.removeListener(streamListener)
            bubbleManager.remove(requestId)
          }
        }

        port.onMessage.addListener(streamListener)
        log.log('Floating bubble created')
      }
      // === END floating bubble ===
      
      const success = sendPortMessage({
        type: 'VISION_QUERY',
        payload: {
          requestId,
          source: 'image-understanding',
          prompt,
          imageBase64: base64,
          scopeId: currentScope.id,
          history: [], // Empty - vision analysis doesn't need conversation context
          imageContext: {
            altText,
            pageTitle,
            pageUrl,
            domain: new URL(pageUrl).hostname,
            surroundingText: surrounding,
          },
        },
      })
      
      if (!success) {
        throw new Error('Port connection lost')
      }
      
      this.showIndicator(img, 'complete')
      
      // Cleanup after 30 seconds
      setTimeout(() => {
        this.processingImages.delete(imgSrc)
      }, 30000)
      
    } catch (err) {
      log.error('❌ Analysis failed:', err)
      this.showIndicator(img, 'error')
      this.processingImages.delete(imgSrc)
      
      // Show error in chat
      const currentScope = getCurrentScope()
      const store = useScopedChatStore.getState()
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Sorry, I couldn't analyze that image. ${err instanceof Error ? err.message : 'Unknown error'}`,
        ts: Date.now(),
        scopeId: currentScope.id,
        status: 'error',
      }
      
      const currentMessages = store.threads.get(currentScope.id) || []
      const newThreads = new Map(store.threads)
      newThreads.set(currentScope.id, [...currentMessages, errorMessage])
      
      useScopedChatStore.setState({
        threads: newThreads,
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  private getImageContext(img: HTMLImageElement): string {
    // Extract surrounding text for context
    const parent = img.closest('article, section, div')
    if (!parent) return ''
    
    const text = parent.textContent?.trim() || ''
    return text.slice(0, 300) // First 300 chars
  }

  private showIndicator(
    img: HTMLImageElement, 
    state: 'analyzing' | 'complete' | 'error' | 'cooldown' | 'rate-limited',
    countdown?: number
  ) {
    // Remove existing indicator
    const existing = document.querySelector('.yumi-image-indicator')
    if (existing) existing.remove()
    
    const rect = img.getBoundingClientRect()
    const indicator = document.createElement('div')
    indicator.className = 'yumi-image-indicator'
    
    // Position overlay on image center
    const left = rect.left + rect.width / 2
    const top = rect.top + rect.height / 2
    
    Object.assign(indicator.style, {
      position: 'fixed',
      left: `${left}px`,
      top: `${top}px`,
      transform: 'translate(-50%, -50%)',
      padding: '12px 20px',
      background: 
        state === 'error' ? 'rgba(239, 68, 68, 0.95)' :
        state === 'cooldown' || state === 'rate-limited' ? 'rgba(245, 158, 11, 0.95)' :
        'rgba(139, 92, 246, 0.95)',
      color: 'white',
      fontSize: '14px',
      fontWeight: '500',
      borderRadius: '16px',
      zIndex: '2147483646',
      pointerEvents: 'none',
      animation: 
        state === 'analyzing' 
          ? 'yumiVisionPulse 1.5s infinite' 
          : 'yumiVisionFadeIn 0.3s ease',
      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
    })
    
    const icons = { 
      analyzing: '🔍', 
      complete: '✅', 
      error: '❌',
      cooldown: '⏱️',
      'rate-limited': '🚫'
    }
    const labels = { 
      analyzing: 'Analyzing...', 
      complete: 'Done!', 
      error: 'Failed',
      cooldown: `Wait ${countdown}s`,
      'rate-limited': 'Rate limit (10/min)'
    }
    
    indicator.textContent = `${icons[state]} ${labels[state]}`
    document.body.appendChild(indicator)
    
    // Auto-remove after timeout
    const timeout = state === 'analyzing' ? 5000 : 2000
    setTimeout(() => {
      indicator.style.animation = 'yumiVisionFadeOut 0.3s ease'
      setTimeout(() => indicator.remove(), 300)
    }, timeout)
  }

  destroy() {
    document.removeEventListener('click', this.onClick, true)
    chrome.runtime.onMessage.removeListener(this.onRuntimeMessage)
    this.processingImages.clear()
    this.recentlyAnalyzed.clear()
    this.analysisTimestamps = []
    log.log(`🧹 Cleaned up (analyzed ${this.analysisCount} images this session)`)
  }
}
