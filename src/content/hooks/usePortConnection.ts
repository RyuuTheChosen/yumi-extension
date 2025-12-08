/**
 * Hook for Port-based streaming connection
 * 
 * Maintains persistent connection to background worker for real-time streaming
 * Features:
 * - Exponential backoff reconnection (1s → 2s → 4s → 8s → 10s cap)
 * - Message queue with flush on reconnect
 * - SPA navigation hardening (BFCache, visibility, history)
 * - Request ID deduplication
 * - Idempotent listener registration
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useScopedChatStore } from '../stores/scopedChat.store'
import { setActivePort } from '../portManager'
import { createLogger } from '../../lib/core/debug'
import { bus } from '../../lib/core/bus'

const log = createLogger('Port')

export interface UsePortConnectionOptions {
  onChunk?: (delta: string) => void
  onEnd?: () => void
  onError?: (error: string) => void
}

interface QueuedMessage {
  type: string
  payload: any
  timestamp: number
}

const MAX_QUEUE_SIZE = 50
const MAX_BACKOFF_MS = 10000
const INITIAL_BACKOFF_MS = 1000
const HEARTBEAT_INTERVAL_MS = 15000

export function usePortConnection(options: UsePortConnectionOptions = {}) {
  const portRef = useRef<chrome.runtime.Port | null>(null)
  const [connected, setConnected] = useState(false)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const heartbeatIntervalRef = useRef<number | null>(null)
  const backoffDelayRef = useRef(INITIAL_BACKOFF_MS)
  const messageQueueRef = useRef<QueuedMessage[]>([])
  const processedRequestIdsRef = useRef(new Set<string>())
  const onMessageHandlerRef = useRef<((msg: any) => void) | null>(null)
  const onDisconnectHandlerRef = useRef<(() => void) | null>(null)
  
  const updateStreamingMessage = useScopedChatStore(s => s.updateStreamingMessage)
  const finalizeStreamingMessage = useScopedChatStore(s => s.finalizeStreamingMessage)
  const setError = useScopedChatStore(s => s.setError)
  const setStatus = useScopedChatStore(s => s.setStatus)
  
  const clearHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current)
      heartbeatIntervalRef.current = null
    }
  }, [])
  
  const startHeartbeat = useCallback(() => {
    clearHeartbeat()
    
    heartbeatIntervalRef.current = window.setInterval(() => {
      if (portRef.current) {
        try {
          portRef.current.postMessage({ type: 'HEARTBEAT' })
        } catch (err) {
          log.log('Heartbeat failed, will reconnect')
          clearHeartbeat()
        }
      }
    }, HEARTBEAT_INTERVAL_MS)
  }, [clearHeartbeat])
  
  const flushQueue = useCallback(() => {
    if (!portRef.current || messageQueueRef.current.length === 0) return
    
    log.log(`Flushing ${messageQueueRef.current.length} queued messages`)
    
    while (messageQueueRef.current.length > 0) {
      const msg = messageQueueRef.current.shift()!
      try {
        portRef.current.postMessage(msg)
        if (chrome.runtime.lastError) {
          log.error('Failed to send queued message:', chrome.runtime.lastError)
          break
        }
      } catch (err) {
        log.error('Exception sending queued message:', err)
        break
      }
    }
  }, [])
  
  const handleMessage = useCallback((msg: any) => {
    const requestId = msg.payload?.requestId
    
    log.log('Received message:', msg.type, msg.payload)
    
    switch (msg.type) {
      case 'STREAM_CHUNK':
        updateStreamingMessage(msg.payload.delta)
        bus.emit('stream', msg.payload.delta, { requestId })
        options.onChunk?.(msg.payload.delta)
        break
        
      case 'STREAM_END':
        log.log('Stream ended, finalizing message')
        if (requestId) {
          processedRequestIdsRef.current.add(requestId)
          if (processedRequestIdsRef.current.size > 100) {
            const arr = Array.from(processedRequestIdsRef.current)
            processedRequestIdsRef.current = new Set(arr.slice(-100))
          }
        }
        bus.emit('streamEnd', { requestId })
        finalizeStreamingMessage()
        options.onEnd?.()
        break
        
      case 'STREAM_ERROR':
        const error = msg.payload.error || 'Stream error'
        bus.emit('streamError', {
          category: 'unknown',
          message: error,
          retriable: false,
          attempt: 1,
          maxAttempts: 1,
          timestamp: Date.now()
        })
        setError(error)
        setStatus('error')
        options.onError?.(error)
        break
        
      case 'PONG':
        // Heartbeat response - connection alive
        break
    }
  }, [updateStreamingMessage, finalizeStreamingMessage, setError, setStatus, options])
  
  const handleDisconnect = useCallback(() => {
    log.log('Disconnected (normal), will reconnect...')
    setConnected(false)
    portRef.current = null
    clearHeartbeat()
    
    // Exponential backoff with cap
    const delay = backoffDelayRef.current
    log.log(`Reconnecting in ${delay}ms`)
    
    reconnectTimeoutRef.current = window.setTimeout(() => {
      connect()
    }, delay)
    
    // Increase backoff for next time (capped)
    backoffDelayRef.current = Math.min(delay * 2, MAX_BACKOFF_MS)
  }, [clearHeartbeat])
  
  const connect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    
    try {
      log.log('Connecting...')
      const port = chrome.runtime.connect({ name: 'yumi-chat' })
      portRef.current = port
      setActivePort(port) // Make port available globally
      
      // Remove old listeners (idempotent)
      if (onMessageHandlerRef.current) {
        try {
          port.onMessage.removeListener(onMessageHandlerRef.current)
        } catch {}
      }
      if (onDisconnectHandlerRef.current) {
        try {
          port.onDisconnect.removeListener(onDisconnectHandlerRef.current)
        } catch {}
      }
      
      // Add new listeners
      onMessageHandlerRef.current = handleMessage
      onDisconnectHandlerRef.current = handleDisconnect
      port.onMessage.addListener(handleMessage)
      port.onDisconnect.addListener(handleDisconnect)
      
      setConnected(true)
      backoffDelayRef.current = INITIAL_BACKOFF_MS // Reset backoff on success
      
      // Start heartbeat
      startHeartbeat()
      
      // Flush any queued messages
      flushQueue()
      
      log.log('✅ Connected')
    } catch (err) {
      log.error('Connection failed:', err)
      setConnected(false)
      handleDisconnect()
    }
  }, [handleMessage, handleDisconnect, startHeartbeat, flushQueue])
  
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    
    clearHeartbeat()
    setActivePort(null) // Clear global port reference
    
    if (portRef.current) {
      // Remove listeners before disconnect
      if (onMessageHandlerRef.current) {
        try {
          portRef.current.onMessage.removeListener(onMessageHandlerRef.current)
        } catch {}
      }
      if (onDisconnectHandlerRef.current) {
        try {
          portRef.current.onDisconnect.removeListener(onDisconnectHandlerRef.current)
        } catch {}
      }
      
      portRef.current.disconnect()
      portRef.current = null
      setConnected(false)
    }
    
    onMessageHandlerRef.current = null
    onDisconnectHandlerRef.current = null
  }, [clearHeartbeat])
  
  const sendMessage = useCallback((scopeId: string, content: string, context?: Record<string, any>) => {
    const requestId = crypto.randomUUID()
    const pageUrl = context?.url || undefined
    const pageTitle = context?.title || undefined
    const message = {
      type: 'SEND_MESSAGE',
      payload: {
        scopeId,
        content,
        context,
        requestId,
        history: context?.history || [],
        memoryContext: context?.memoryContext || undefined,  // Memory context for personalization
        selectedContext: context?.selectedContext || undefined,  // Right-click context menu content
        pageContext: context?.pageContext || undefined,  // Extracted page content
        pageType: context?.pageType || undefined,  // Detected page type
        pageUrl,  // Current page URL for context
        pageTitle,  // Current page title for context
        pageContent: context?.pageContent || undefined,  // Extracted page content
        screenshot: context?.screenshot || undefined,  // Vision query screenshot
        searchContext: context?.searchContext || undefined,  // Web search results
      }
    }
    
    if (!portRef.current || !connected) {
      log.log('Queueing message (not connected)')
      
      // Add to queue with size limit
      if (messageQueueRef.current.length < MAX_QUEUE_SIZE) {
        messageQueueRef.current.push({
          ...message,
          timestamp: Date.now()
        })
      } else {
        log.warn('Message queue full, dropping message')
      }
      
      return false
    }
    
    try {
      portRef.current.postMessage(message)
      
      if (chrome.runtime.lastError) {
        log.error('Send failed:', chrome.runtime.lastError)
        return false
      }
      
      return true
    } catch (err) {
      log.error('Send exception:', err)
      return false
    }
  }, [connected])
  
  // SPA navigation hardening
  useEffect(() => {
    // BFCache restoration
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted && !portRef.current) {
        log.log('BFCache restore, reconnecting')
        connect()
      }
    }
    
    // Visibility change (tab becomes visible)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !portRef.current) {
        log.log('Tab visible, reconnecting')
        connect()
      }
    }
    
    // History API monkey-patching for SPA navigation
    const originalPushState = history.pushState
    const originalReplaceState = history.replaceState
    
    history.pushState = function(...args) {
      const result = originalPushState.apply(this, args)
      if (!portRef.current) {
        log.log('pushState detected, reconnecting')
        connect()
      }
      return result
    }
    
    history.replaceState = function(...args) {
      const result = originalReplaceState.apply(this, args)
      if (!portRef.current) {
        log.log('replaceState detected, reconnecting')
        connect()
      }
      return result
    }
    
    const handlePopState = () => {
      if (!portRef.current) {
        log.log('popstate detected, reconnecting')
        connect()
      }
    }
    
    window.addEventListener('pageshow', handlePageShow)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('popstate', handlePopState)
    
    return () => {
      window.removeEventListener('pageshow', handlePageShow)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('popstate', handlePopState)
      history.pushState = originalPushState
      history.replaceState = originalReplaceState
    }
  }, [connect])
  
  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connect()
    return () => disconnect()
  }, [])
  
  return {
    connected,
    sendMessage,
    sendViaPort: sendMessage, // Alias for ChatOverlay compatibility
    reconnect: connect
  }
}
