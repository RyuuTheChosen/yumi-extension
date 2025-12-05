/**
 * Chrome Runtime Message Type Definitions
 *
 * Strongly typed message passing between extension contexts.
 */

/**
 * Base runtime message
 */
export interface RuntimeMessage {
  type: string
  payload?: unknown
}

/**
 * Stream chunk message (background → content)
 */
export interface StreamChunkMessage extends RuntimeMessage {
  type: 'STREAM_CHUNK'
  payload: {
    delta: string
    requestId: string
    scopeId: string
  }
}

/**
 * Stream end message
 */
export interface StreamEndMessage extends RuntimeMessage {
  type: 'STREAM_END'
  payload: {
    requestId: string
    scopeId: string
  }
}

/**
 * Stream error message
 */
export interface StreamErrorMessage extends RuntimeMessage {
  type: 'STREAM_ERROR'
  payload: {
    error: string
    requestId: string
    scopeId: string
  }
}

/**
 * Memory extraction request
 */
export interface MemoryExtractionMessage extends RuntimeMessage {
  type: 'MEMORY_EXTRACTION'
  payload: {
    messages: Array<{
      role: string
      content: string
    }>
    scopeId: string
  }
}

/**
 * Memory get all request
 */
export interface MemoryGetAllMessage extends RuntimeMessage {
  type: 'MEMORY_GET_ALL'
  payload: undefined
}

/**
 * Memory add request
 */
export interface MemoryAddMessage extends RuntimeMessage {
  type: 'MEMORY_ADD'
  payload: {
    type: string
    content: string
    importance: number
    confidence: number
  }
}

/**
 * Companion changed notification
 */
export interface CompanionChangedMessage extends RuntimeMessage {
  type: 'COMPANION_CHANGED'
  payload: {
    slug: string
  }
}

/**
 * Port connection message
 */
export interface PortConnectMessage {
  type: 'CONNECT'
  scopeId: string
  tabId: number
}

/**
 * Port heartbeat message
 */
export interface PortHeartbeatMessage {
  type: 'HEARTBEAT'
  timestamp: number
}

/**
 * Union type of all runtime messages
 */
export type ExtensionMessage =
  | StreamChunkMessage
  | StreamEndMessage
  | StreamErrorMessage
  | MemoryExtractionMessage
  | MemoryGetAllMessage
  | MemoryAddMessage
  | CompanionChangedMessage
  | RuntimeMessage

/**
 * Message handler type
 */
export type MessageHandler<T extends RuntimeMessage = RuntimeMessage> = (
  message: T,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => boolean | void | Promise<void>

/**
 * Port message handler type
 */
export type PortMessageHandler<T = unknown> = (
  message: T,
  port: chrome.runtime.Port
) => void
