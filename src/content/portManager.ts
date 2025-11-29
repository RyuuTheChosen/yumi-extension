/**
 * Global port manager for sending messages from non-React contexts
 * The port connection is established by usePortConnection hook in the chat overlay
 */

let activePort: chrome.runtime.Port | null = null

export function setActivePort(port: chrome.runtime.Port | null) {
  activePort = port
  console.log('[PortManager] Active port:', port ? 'connected' : 'disconnected')
}

export function getActivePort(): chrome.runtime.Port | null {
  return activePort
}

export function sendPortMessage(message: any): boolean {
  if (!activePort) {
    console.warn('[PortManager] No active port, cannot send:', message.type)
    return false
  }

  try {
    activePort.postMessage(message)
    return true
  } catch (error) {
    console.error('[PortManager] Failed to send message:', error)
    return false
  }
}
