/**
 * Port Manager Module
 *
 * Handles Chrome runtime port lifecycle for persistent streaming connections.
 * Manages port registration, message routing, heartbeat, and cleanup.
 */

import { createLogger } from '../lib/debug'
import { PORT_NAMES } from '../lib/constants'
import { streamToPort } from './streaming'
import { handleVisionQuery } from './vision'

const log = createLogger('PortManager')

/**
 * Port connection metadata
 */
interface PortConnection {
  port: chrome.runtime.Port
  tabId: number | null
  connectTime: number
}

/**
 * Active port connections
 * Stored to prevent GC and enable heartbeat keep-alive
 */
export const activePorts = new Map<string, PortConnection>()

/**
 * Initialize port connection handlers
 *
 * Sets up listeners for:
 * - New port connections
 * - Port messages (SEND_MESSAGE, VISION_QUERY, HEARTBEAT)
 * - Port disconnections
 */
export function initializePortHandlers(): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAMES.CHAT) return

    // Get tab ID from sender (null for popup/sidepanel)
    const tabId = port.sender?.tab?.id || null
    const portId = tabId !== null ? `tab-${tabId}` : crypto.randomUUID()

    log.log(`[PortManager] Port connected: ${port.name} (${portId})`)

    // Store port to prevent GC and enable heartbeat
    activePorts.set(portId, {
      port,
      tabId,
      connectTime: Date.now()
    })

    // Handle incoming messages from port
    port.onMessage.addListener(async (msg) => {
      const startTime = Date.now()

      switch (msg.type) {
        case 'SEND_MESSAGE':
          await streamToPort(port, msg.payload, startTime)
          break

        case 'VISION_QUERY':
          await handleVisionQuery(port, msg.payload)
          break

        case 'HEARTBEAT':
          // Respond to heartbeat to keep connection alive
          try {
            port.postMessage({ type: 'PONG' })
          } catch (err) {
            log.error('[PortManager] Heartbeat response failed:', err)
          }
          break
      }
    })

    // Handle port disconnection
    port.onDisconnect.addListener(() => {
      const connection = activePorts.get(portId)
      if (connection) {
        const elapsed = Date.now() - connection.connectTime
        log.log(`[PortManager] Port disconnected: ${port.name} (${portId}, lived ${elapsed}ms)`)
      }
      activePorts.delete(portId)
    })
  })

  log.log('[PortManager] Port handlers initialized')
}
