/**
 * Floating Response Bubble
 *
 * Displays LLM responses as a temporary floating bubble above the avatar.
 * Only shows when chat overlay is closed.
 * Features:
 * - Positioned above avatar
 * - Streaming text animation
 * - Auto-fade after configurable delay
 * - Manual close button
 */

import { isChatOverlayOpen } from '../chatState'
import { createLogger } from '../../lib/debug'

const log = createLogger('FloatingBubble')

export interface FloatingBubbleConfig {
  position: { x: number; y: number }
  anchor: 'selection' | 'image' | 'avatar'
  autoFadeMs?: number
  maxHeight?: number
  maxWidth?: number
}

export type VisionStage = 'analyzing' | 'thinking' | 'error' | 'timeout'

export class FloatingResponseBubble {
  private container: HTMLElement | null = null
  private contentEl: HTMLElement | null = null
  private content: string = ''
  private fadeTimeout: number | null = null
  private requestId: string = ''
  private isVisible: boolean = false
  private config: FloatingBubbleConfig | null = null
  private currentStage: VisionStage | null = null
  
  /**
   * Show the bubble at the specified position
   * Returns false if chat overlay is open (bubble not shown)
   */
  show(config: FloatingBubbleConfig, requestId: string): boolean {
    // Don't show bubble if chat overlay is open
    if (isChatOverlayOpen()) {
      log.log('Chat overlay is open, skipping bubble')
      return false
    }

    // Clean up existing bubble first
    if (this.container) {
      this.hide(true) // Immediate hide
    }

    this.config = config
    this.requestId = requestId
    this.content = ''
    this.isVisible = true

    // Create container
    this.container = document.createElement('div')
    this.container.className = 'yumi-floating-bubble'
    this.container.setAttribute('data-request-id', requestId)

    // Calculate smart position (above avatar)
    const { x, y } = this.calculatePosition(config)

    const maxWidth = config.maxWidth || 320
    const maxHeight = config.maxHeight || 200

    Object.assign(this.container.style, {
      position: 'fixed',
      left: `${x}px`,
      top: `${y}px`,
      maxWidth: `${maxWidth}px`,
      maxHeight: `${maxHeight}px`,
      width: 'auto',
      minWidth: '200px',
      zIndex: '2147483645',
      pointerEvents: 'auto',

      // Glass dark design
      background: 'rgba(20, 20, 20, 0.90)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      borderRadius: '12px',
      padding: '12px 14px',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
      border: '1px solid rgba(255, 255, 255, 0.15)',

      // Animation
      opacity: '0',
      transform: 'translateY(8px)',
      transition: 'all 0.2s ease-out',

      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      display: 'flex',
      flexDirection: 'column',
    })

    // Close button (top-right corner, minimal)
    const closeBtn = document.createElement('button')
    closeBtn.textContent = '×'
    closeBtn.setAttribute('aria-label', 'Close bubble')
    Object.assign(closeBtn.style, {
      position: 'absolute',
      top: '6px',
      right: '6px',
      width: '18px',
      height: '18px',
      borderRadius: '4px',
      border: 'none',
      background: 'transparent',
      color: 'rgba(255, 255, 255, 0.4)',
      fontSize: '16px',
      fontWeight: '500',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'color 0.15s, background 0.15s',
      lineHeight: '1',
      padding: '0',
      zIndex: '10'
    })
    closeBtn.onmouseenter = () => {
      closeBtn.style.background = 'rgba(255, 255, 255, 0.1)'
      closeBtn.style.color = 'rgba(255, 255, 255, 0.8)'
    }
    closeBtn.onmouseleave = () => {
      closeBtn.style.background = 'transparent'
      closeBtn.style.color = 'rgba(255, 255, 255, 0.4)'
    }
    closeBtn.onclick = () => this.hide()

    // Content area (scrollable)
    this.contentEl = document.createElement('div')
    this.contentEl.className = 'yumi-bubble-content'
    Object.assign(this.contentEl.style, {
      fontSize: '13px',
      lineHeight: '1.5',
      color: 'rgba(255, 255, 255, 0.9)',
      fontWeight: '400',
      overflowY: 'auto',
      overflowX: 'hidden',
      maxHeight: `${maxHeight - 40}px`,
      wordWrap: 'break-word',
      whiteSpace: 'pre-wrap',
      scrollbarWidth: 'thin',
      scrollbarColor: 'rgba(255, 255, 255, 0.2) transparent',
      paddingRight: '16px' // Space for close button
    })

    // Set initial content to "Analyzing..."
    this.contentEl.textContent = 'Analyzing...'
    this.contentEl.style.color = 'rgba(255, 255, 255, 0.5)'
    this.contentEl.style.fontStyle = 'italic'

    // Assemble (close button + content)
    this.container.appendChild(closeBtn)
    this.container.appendChild(this.contentEl)

    document.body.appendChild(this.container)

    // Trigger entrance animation
    requestAnimationFrame(() => {
      if (this.container) {
        this.container.style.opacity = '1'
        this.container.style.transform = 'translateY(0)'
      }
    })

    log.log('Shown at', { x, y, requestId })
    return true
  }
  
  /**
   * Calculate smart position - positions bubble above the avatar
   */
  private calculatePosition(config: FloatingBubbleConfig): { x: number; y: number } {
    const { x: rawX, y: rawY } = config.position
    const maxWidth = config.maxWidth || 320
    const maxHeight = config.maxHeight || 200
    const padding = 16

    // Get avatar wrapper for more accurate positioning
    const avatarWrapper = document.querySelector('.yumi-overlay-wrapper') as HTMLElement
    let finalX: number
    let finalY: number

    if (avatarWrapper) {
      const rect = avatarWrapper.getBoundingClientRect()
      // Position above avatar, aligned to right edge
      finalX = rect.right - maxWidth
      finalY = rect.top - maxHeight - 12 // 12px gap above avatar
    } else {
      // Fallback: use provided position
      finalX = rawX - maxWidth
      finalY = rawY - maxHeight - 12
    }

    // Ensure within viewport bounds
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    // Horizontal bounds
    if (finalX < padding) {
      finalX = padding
    } else if (finalX + maxWidth > viewportWidth - padding) {
      finalX = viewportWidth - maxWidth - padding
    }

    // Vertical bounds - if not enough space above, position below
    if (finalY < padding) {
      if (avatarWrapper) {
        const rect = avatarWrapper.getBoundingClientRect()
        finalY = rect.bottom + 12
      } else {
        finalY = rawY + 12
      }
    }

    return { x: finalX, y: finalY }
  }
  
  /**
   * Update the current processing stage - shows message in content area
   */
  setStage(stage: VisionStage, message?: string) {
    if (!this.contentEl || !this.isVisible) return

    this.currentStage = stage

    // Only update if we haven't started streaming real content yet
    if (this.content.length === 0) {
      const stageMessages: Record<VisionStage, string> = {
        analyzing: 'Analyzing...',
        thinking: 'Yumi is thinking...',
        error: 'Something went wrong',
        timeout: 'Taking longer than expected...'
      }

      this.contentEl.textContent = message || stageMessages[stage]
      this.contentEl.style.color = stage === 'error' ? 'rgba(239, 68, 68, 0.9)' : 'rgba(255, 255, 255, 0.5)'
      this.contentEl.style.fontStyle = 'italic'
    }

    log.log(`Stage updated to: ${stage}`)
  }

  /**
   * Append streaming chunk
   */
  appendChunk(delta: string) {
    if (!this.contentEl || !this.isVisible) return

    // First chunk - reset styling from stage message
    if (this.content.length === 0) {
      this.contentEl.style.color = 'rgba(255, 255, 255, 0.9)'
      this.contentEl.style.fontStyle = 'normal'
    }

    this.content += delta

    // Update content
    this.contentEl.textContent = this.content

    // Auto-scroll to bottom
    this.contentEl.scrollTop = this.contentEl.scrollHeight
  }
  
  /**
   * Finalize streaming (stream complete)
   */
  finalize(autoFadeMs?: number) {
    if (!this.isVisible) return

    log.log('Stream complete, starting fade timer')

    // Start auto-fade timer
    const fadeDelay = autoFadeMs || this.config?.autoFadeMs || 12000

    if (this.fadeTimeout) {
      clearTimeout(this.fadeTimeout)
    }

    this.fadeTimeout = window.setTimeout(() => {
      this.hide()
    }, fadeDelay)
  }
  
  /**
   * Show error state
   */
  showError(errorMsg: string) {
    if (!this.contentEl || !this.isVisible) return

    // Show error message as plain text
    this.contentEl.textContent = errorMsg
    this.contentEl.style.color = '#ef4444'
    this.contentEl.style.fontStyle = 'normal'

    // Auto-hide after 5 seconds
    if (this.fadeTimeout) {
      clearTimeout(this.fadeTimeout)
    }
    this.fadeTimeout = window.setTimeout(() => this.hide(), 5000)
  }
  
  /**
   * Hide and remove bubble
   */
  hide(immediate: boolean = false) {
    if (!this.container) return

    this.isVisible = false

    // Clear fade timeout
    if (this.fadeTimeout) {
      clearTimeout(this.fadeTimeout)
      this.fadeTimeout = null
    }

    if (immediate) {
      // Immediate removal (for cleanup)
      this.container.remove()
      this.container = null
      this.contentEl = null
      return
    }

    // Fade out animation
    this.container.style.opacity = '0'
    this.container.style.transform = 'translateY(8px)'

    setTimeout(() => {
      if (this.container) {
        this.container.remove()
        this.container = null
        this.contentEl = null
      }
    }, 200)
  }
  
  /**
   * Check if bubble is currently visible
   */
  isShowing(): boolean {
    return this.isVisible
  }
  
  /**
   * Get request ID
   */
  getRequestId(): string {
    return this.requestId
  }
}

// Singleton instance manager for multiple bubbles
class BubbleManager {
  private bubbles: Map<string, FloatingResponseBubble> = new Map()
  private readonly MAX_BUBBLES = 1 // Only show 1 bubble at a time

  /**
   * Create and show a bubble. Returns the bubble if shown, null if chat overlay is open.
   */
  create(config: FloatingBubbleConfig, requestId: string): FloatingResponseBubble | null {
    // Remove oldest bubble if at limit
    if (this.bubbles.size >= this.MAX_BUBBLES) {
      const oldestId = Array.from(this.bubbles.keys())[0]
      const oldest = this.bubbles.get(oldestId)
      if (oldest) {
        oldest.hide()
        this.bubbles.delete(oldestId)
      }
    }

    const bubble = new FloatingResponseBubble()
    const shown = bubble.show(config, requestId)

    if (!shown) {
      // Bubble was not shown (chat overlay is open)
      return null
    }

    this.bubbles.set(requestId, bubble)
    return bubble
  }

  get(requestId: string): FloatingResponseBubble | undefined {
    return this.bubbles.get(requestId)
  }

  remove(requestId: string) {
    this.bubbles.delete(requestId)
  }

  hideAll() {
    this.bubbles.forEach(bubble => bubble.hide())
    this.bubbles.clear()
  }
}

export const bubbleManager = new BubbleManager()
