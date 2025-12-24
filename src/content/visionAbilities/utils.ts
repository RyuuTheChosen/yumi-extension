import { createLogger } from '../../lib/core/debug'
import { bubbleManager, type FloatingResponseBubble } from './FloatingResponseBubble'

const log = createLogger('VisionUtils')

const VISION_TIMEOUT_MS = 30000

/**
 * Convert image to base64 (with size limit)
 * Handles CORS-protected images by fetching them first
 */
export async function imageToBase64(
  img: HTMLImageElement,
  maxWidth: number = 512
): Promise<string> {
  try {
    // Try direct conversion first (for same-origin images)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Could not get canvas context')
    }

    const scale = img.width > maxWidth ? maxWidth / img.width : 1
    canvas.width = img.width * scale
    canvas.height = img.height * scale

    // Create a new image to avoid tainted canvas
    const cleanImg = new Image()
    cleanImg.crossOrigin = 'anonymous'
    
    return new Promise((resolve, reject) => {
      cleanImg.onload = () => {
        try {
          ctx.drawImage(cleanImg, 0, 0, canvas.width, canvas.height)
          const base64 = canvas.toDataURL('image/jpeg', 0.5)
          resolve(base64)
        } catch (err) {
          // If still fails, try fetch approach
          fetchAndConvertImage(img.src, maxWidth)
            .then(resolve)
            .catch(reject)
        }
      }
      
      cleanImg.onerror = () => {
        // Fallback to fetch approach
        fetchAndConvertImage(img.src, maxWidth)
          .then(resolve)
          .catch(reject)
      }
      
      cleanImg.src = img.src
    })
  } catch (err) {
    // Final fallback
    return fetchAndConvertImage(img.src, maxWidth)
  }
}

/**
 * Fetch image via background script and convert to base64
 * This bypasses CORS restrictions
 */
async function fetchAndConvertImage(
  imageUrl: string,
  maxWidth: number = 512
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Send fetch request to background script (which has host_permissions)
    chrome.runtime.sendMessage({
      type: 'FETCH_IMAGE',
      payload: { url: imageUrl },
    }, async (response) => {
      try {
        if (!response?.success || !response?.blob) {
          reject(new Error(response?.error || 'Failed to fetch image'))
          return
        }
        
        // response.blob is already a base64 data URL from FileReader
        const img = new Image()
        
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas')
            const ctx = canvas.getContext('2d')
            if (!ctx) {
              reject(new Error('Could not get canvas context'))
              return
            }
            
            const scale = img.width > maxWidth ? maxWidth / img.width : 1
            canvas.width = img.width * scale
            canvas.height = img.height * scale
            
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
            const base64 = canvas.toDataURL('image/jpeg', 0.5)
            resolve(base64)
          } catch (err) {
            reject(new Error(`Failed to convert image: ${err instanceof Error ? err.message : 'Unknown error'}`))
          }
        }
        
        img.onerror = () => {
          reject(new Error('Failed to load image'))
        }
        
        img.src = response.blob
      } catch (err) {
        reject(new Error(`Failed to process image: ${err instanceof Error ? err.message : 'Unknown error'}`))
      }
    })
  })
}

/**
 * Get surrounding context for selection
 */
export function getSurroundingText(selection: Selection): string {
  if (!selection.rangeCount) return ''
  
  const range = selection.getRangeAt(0)
  const container = range.commonAncestorContainer
  const fullText = container.textContent || ''
  const selectedText = selection.toString()
  
  const startIndex = fullText.indexOf(selectedText)
  if (startIndex === -1) return ''
  
  const before = fullText.slice(Math.max(0, startIndex - 100), startIndex)
  const after = fullText.slice(
    startIndex + selectedText.length,
    startIndex + selectedText.length + 100
  )
  
  return `...${before}[SELECTED: ${selectedText}]${after}...`
}

/**
 * Get avatar container position for bubble positioning
 */
export function getAvatarPosition(): { x: number; y: number } | null {
  const avatarWrapper = document.querySelector('#yumi-overlay-wrapper') as HTMLElement
  if (!avatarWrapper) {
    log.warn('Avatar wrapper not found')
    return null
  }

  const rect = avatarWrapper.getBoundingClientRect()
  return {
    x: rect.right,
    y: rect.top
  }
}

/**
 * Get avatar position with fallback to bottom-right corner
 * Use this when bubble must be shown regardless of avatar state
 */
export function getAvatarPositionWithFallback(): { x: number; y: number } {
  const avatarPos = getAvatarPosition()
  if (avatarPos) return avatarPos

  return {
    x: window.innerWidth - 20,
    y: window.innerHeight - 150
  }
}

export interface StreamListenerCleanup {
  cleanup: () => void
  clearTimeout: () => void
}

/**
 * Setup stream listener with automatic cleanup on timeout or port disconnect
 * Returns cleanup functions for manual cleanup if needed
 */
export function setupStreamListenerCleanup(
  port: chrome.runtime.Port,
  listener: (msg: unknown) => void,
  requestId: string,
  bubble: FloatingResponseBubble | null,
  timeoutMs: number = VISION_TIMEOUT_MS
): StreamListenerCleanup {
  let isCleanedUp = false

  const cleanup = () => {
    if (isCleanedUp) return
    isCleanedUp = true

    try {
      port.onMessage.removeListener(listener)
    } catch {
      /** Port may already be disconnected */
    }
    bubbleManager.remove(requestId)
    log.log('Stream listener cleaned up for:', requestId)
  }

  const timeout = window.setTimeout(() => {
    if (bubble?.isShowing()) {
      bubble.showError('Request timed out')
    }
    cleanup()
    log.warn('Vision request timed out:', requestId)
  }, timeoutMs)

  const clearTimeoutFn = () => {
    window.clearTimeout(timeout)
  }

  const disconnectListener = () => {
    clearTimeoutFn()
    cleanup()
    log.log('Port disconnected, cleaned up:', requestId)
  }

  try {
    port.onDisconnect.addListener(disconnectListener)
  } catch {
    /** Port may already be disconnected */
  }

  return { cleanup, clearTimeout: clearTimeoutFn }
}

/**
 * Inject CSS animations for indicators and floating bubbles
 */
export function injectVisionStyles() {
  if (document.getElementById('yumi-vision-styles')) return
  
  const style = document.createElement('style')
  style.id = 'yumi-vision-styles'
  style.textContent = `
    @keyframes yumiVisionFadeIn {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes yumiVisionFadeOut {
      from { opacity: 1; }
      to { opacity: 0; }
    }
    @keyframes yumiVisionPulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.05); }
    }
    @keyframes yumiDotPulse {
      0%, 80%, 100% { 
        transform: scale(0.8);
        opacity: 0.5;
      }
      40% { 
        transform: scale(1.2);
        opacity: 1;
      }
    }
    
    /* Floating bubble scrollbar styles */
    .yumi-bubble-content::-webkit-scrollbar {
      width: 6px;
    }
    .yumi-bubble-content::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.05);
      border-radius: 10px;
    }
    .yumi-bubble-content::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 10px;
    }
    .yumi-bubble-content::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.3);
    }
  `
  document.head.appendChild(style)
}
