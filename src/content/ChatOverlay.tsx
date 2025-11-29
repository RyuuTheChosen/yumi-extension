import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createLogger } from '../lib/debug'
import { CHAT } from '../lib/design/dimensions'
import { useScopedChatStore } from './stores/scopedChat.store'

const log = createLogger('ChatOverlay')
import { usePersonalityStore } from '../lib/stores/personality.store'
import { useSettingsStore } from '../lib/stores/settings.store'
import { usePortConnection } from './hooks/usePortConnection'
import { ChatHeader } from './components/ChatHeader'
import { MessageBubble } from './components/MessageBubble'
import { MessageInput } from './components/MessageInput'
import { EmptyState } from './components/EmptyState'
import { getThreadMessages } from './utils/db'
import { setChatOpen } from './chatState'
import {
  useMemoryStore,
  getMemoriesForPrompt,
  extractMemoriesFromConversation,
  shouldExtract,
  EXTRACTION_CONFIG,
} from '../lib/memory'
import { isVisionQuery } from '../lib/context/visionTrigger'
import { extractPageContext, buildContextForPrompt } from '../lib/context'
import { ttsService } from '../lib/tts'
import { bus } from '../lib/bus'
import { getActiveCompanion } from '../lib/companions/loader'

// Debug panel: only available in development builds
declare const __DEV__: boolean
const ExpressionDebugPanel = __DEV__
  ? React.lazy(() => import('./components/ExpressionDebugPanel').then(m => ({ default: m.ExpressionDebugPanel })))
  : null
const SHOW_DEBUG_PANEL = __DEV__ && false // Set to true to enable in dev

interface ChatOverlayProps {
  chatButton?: HTMLButtonElement
  onToggle?: (isOpen: boolean) => void
}

/**
 * Phase 2: Full chat UI integrated into overlay
 * Scoped conversation threads with port-based streaming and IndexedDB persistence
 */
export const ChatOverlay: React.FC<ChatOverlayProps> = ({ chatButton, onToggle }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [historyCount, setHistoryCount] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(false)

  // Pre-filled context from context menu (right-click "Ask Yumi about this")
  const [prefilledContext, setPrefilledContext] = useState<string | null>(null)
  const [contextSource, setContextSource] = useState<'selection' | 'element' | null>(null)

  const currentScope = useScopedChatStore(s => s.currentScope)
  const threads = useScopedChatStore(s => s.threads)
  const streamingMessage = useScopedChatStore(s => s.streamingMessage)
  const status = useScopedChatStore(s => s.status)
  const error = useScopedChatStore(s => s.error)
  const isCleared = useScopedChatStore(s => s.isCleared)
  const sendMessageAction = useScopedChatStore(s => s.sendMessage)
  const reloadThread = useScopedChatStore(s => s.reloadThread)
  const privateMode = useScopedChatStore(s => s.privateMode)
  
  // Derive display messages with useMemo to avoid calling store methods in selectors
  const displayMessages = useMemo(() => {
    const threadMessages = threads.get(currentScope.id) || []
    if (streamingMessage && !threadMessages.find(m => m.id === streamingMessage.id)) {
      return [...threadMessages, streamingMessage]
    }
    return threadMessages
  }, [threads, currentScope.id, streamingMessage])
  
  // Personality store (pre-hydrated by overlayAvatar.ts)
  const activePersonality = usePersonalityStore(s => {
    const activeId = s.activeId
    return s.list.find(p => p.id === activeId)
  })

  // Get stable reference to ensureDefault (runs exactly once)
  const ensureDefaultPersonality = useMemo(() => usePersonalityStore.getState().ensureDefault, [])

  // Memory store
  const memories = useMemoryStore(s => s.memories)
  const memoriesLoaded = useMemoryStore(s => s.isLoaded)
  const lastExtractionAt = useMemoryStore(s => s.lastExtractionAt)
  const loadMemories = useMemo(() => useMemoryStore.getState().loadMemories, [])
  const addMemories = useMemo(() => useMemoryStore.getState().addMemories, [])
  const setLastExtractionAt = useMemo(() => useMemoryStore.getState().setLastExtractionAt, [])

  // TTS settings (voice from companion, volume from settings)
  const ttsEnabled = useSettingsStore(s => s.ttsEnabled)
  const ttsVolume = useSettingsStore(s => s.ttsVolume)
  const activeCompanionSlug = useSettingsStore(s => s.activeCompanionSlug)
  const hubUrl = useSettingsStore(s => s.hubUrl)
  const hubAccessToken = useSettingsStore(s => s.hubAccessToken)

  // Extraction timer ref
  const extractionTimerRef = useRef<number | null>(null)
  
  // Port-based streaming connection
  const { connected, sendMessage: sendViaPort } = usePortConnection()
  
  // Refs for stable callback closures (must be declared before any useEffect/useCallback)
  const statusRef = useRef(status)
  const connectedRef = useRef(connected)
  const sendViaPortRef = useRef(sendViaPort)
  const currentScopeRef = useRef(currentScope)
  const sendMessageActionRef = useRef(sendMessageAction)

  // Connect to native button
  useEffect(() => {
    if (!chatButton) return

    const handleClick = () => {
      setIsExpanded(prev => {
        const newState = !prev
        setChatOpen(newState) // Update global state for floating bubble
        onToggle?.(newState)
        return newState
      })
    }

    chatButton.addEventListener('click', handleClick)
    return () => chatButton.removeEventListener('click', handleClick)
  }, [chatButton, onToggle])

  // Ensure a default personality exists on mount
  useEffect(() => {
    ensureDefaultPersonality()
  }, [ensureDefaultPersonality])

  // Listen for context menu events (right-click "Ask Yumi about this")
  useEffect(() => {
    const handleContextEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ text: string; source: 'selection' | 'element' }>
      if (customEvent.detail?.text) {
        log.log(' Context received:', customEvent.detail.source, customEvent.detail.text.slice(0, 100) + '...')
        setPrefilledContext(customEvent.detail.text)
        setContextSource(customEvent.detail.source)
        // Auto-expand chat when context is loaded
        setIsExpanded(true)
        setChatOpen(true)
        onToggle?.(true)
      }
    }

    window.addEventListener('yumi:open-with-context', handleContextEvent)
    return () => window.removeEventListener('yumi:open-with-context', handleContextEvent)
  }, [onToggle])

  // Load memories on mount
  useEffect(() => {
    if (!memoriesLoaded) {
      loadMemories().then(() => {
        log.log(' Memories loaded')
      })
    }
  }, [memoriesLoaded, loadMemories])

  // Initialize TTS service with Hub credentials and companion voice
  useEffect(() => {
    if (!ttsEnabled) {
      log.log(' TTS disabled')
      return
    }

    if (!hubUrl || !hubAccessToken) {
      log.log(' TTS enabled but not logged in to Hub')
      return
    }

    // Load companion to get voice from personality
    const initTTS = async () => {
      try {
        const companion = await getActiveCompanion(activeCompanionSlug)
        const voiceId = companion.personality.voice?.voiceId || 'MEJe6hPrI48Kt2lFuVe3' // Fallback to Yumi

        ttsService.initialize(hubUrl, hubAccessToken, {
          enabled: ttsEnabled,
          voice: voiceId,
          volume: ttsVolume,
        })
        log.log(' TTS initialized with companion voice:', voiceId)
      } catch (err) {
        log.error(' Failed to load companion for TTS:', err)
      }
    }

    initTTS()
  }, [ttsEnabled, ttsVolume, activeCompanionSlug, hubUrl, hubAccessToken])

  // REMOVED: Auto-expand chat when streaming (now handled by floating bubble)
  // Vision queries show responses in floating bubble, user opens chat manually if needed

  // Check if history exists in IndexedDB only when explicitly cleared
  useEffect(() => {
    const checkHistory = async () => {
      if (isCleared && displayMessages.length === 0) {
        setHistoryLoading(true)
        try {
          const messages = await getThreadMessages(currentScope.id)
          const count = messages.length
          setHistoryCount(prev => prev !== count ? count : prev)
        } catch (err) {
          log.error(' Failed to check history:', err)
          setHistoryCount(prev => prev !== 0 ? 0 : prev)
        } finally {
          setHistoryLoading(false)
        }
      } else {
        setHistoryCount(prev => prev !== 0 ? 0 : prev)
      }
    }

    checkHistory()
  }, [isCleared, displayMessages.length, currentScope.id])
  
  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [displayMessages])

  // Trigger memory extraction after conversation ends (idle after streaming)
  const prevStatusRef = useRef<string>(status)
  const extractionScheduledRef = useRef<boolean>(false)

  useEffect(() => {
    const wasStreaming = prevStatusRef.current === 'streaming'
    const wasIdle = prevStatusRef.current === 'idle'
    prevStatusRef.current = status

    // Emit thinking:start when streaming begins
    if (wasIdle && status === 'streaming') {
      bus.emit('avatar', { type: 'thinking:start' })
    }

    // Check if we just finished streaming
    if (wasStreaming && status === 'idle') {
      log.log(' Stream ended, scheduling extraction in 30s...')

      // Emit thinking:stop when streaming ends
      bus.emit('avatar', { type: 'thinking:stop' })

      // Trigger TTS for the last assistant message
      if (ttsEnabled && displayMessages.length > 0) {
        const lastMessage = displayMessages[displayMessages.length - 1]
        if (lastMessage.role === 'assistant' && lastMessage.content) {
          log.log(' Speaking response via TTS...')

          // Emit speaking events
          bus.emit('avatar', { type: 'speaking:start' })
          ttsService.speak(lastMessage.content)
            .then(() => {
              bus.emit('avatar', { type: 'speaking:stop' })
            })
            .catch(err => {
              log.error(' TTS failed:', err)
              bus.emit('avatar', { type: 'speaking:stop' })
            })
        }
      }

      // Clear any existing extraction timer
      if (extractionTimerRef.current) {
        clearTimeout(extractionTimerRef.current)
      }

      extractionScheduledRef.current = true

      // Schedule extraction after idle delay
      extractionTimerRef.current = window.setTimeout(async () => {
        extractionScheduledRef.current = false
        const memoryStore = useMemoryStore.getState()

        // Check if extraction should run
        if (!shouldExtract(memoryStore.lastExtractionAt, displayMessages.length)) {
          log.log(' Skipping extraction (too soon or not enough messages)')
          return
        }

        log.log(' Triggering memory extraction...')
        log.log(' displayMessages count:', displayMessages.length)

        // Get recent messages for extraction
        const recentMessages = displayMessages.slice(-EXTRACTION_CONFIG.batchSize).map(m => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
          id: m.id,
          ts: m.ts,
        }))

        log.log(' Sending messages for extraction:', recentMessages.map(m => ({
          role: m.role,
          contentPreview: m.content.substring(0, 100) + (m.content.length > 100 ? '...' : '')
        })))

        const result = await extractMemoriesFromConversation(
          recentMessages,
          memoryStore.memories,
          currentScope.id
        )

        log.log(' Extraction result:', result.success, 'memories:', result.memories.length)
        if (result.raw) {
          log.log(' Raw extraction response:', result.raw)
        }

        if (result.success && result.memories.length > 0) {
          // Add source info to extracted memories
          const memoriesWithSource = result.memories.map(m => ({
            ...m,
            source: {
              conversationId: currentScope.id,
              messageId: recentMessages[recentMessages.length - 1]?.id || '',
              url: window.location.href,
              timestamp: Date.now(),
            }
          }))

          await addMemories(memoriesWithSource)
          log.log(`Extracted and saved ${result.memories.length} memories`)
        } else if (!result.success) {
          log.error(' Extraction failed:', result.error)
        }

        setLastExtractionAt(Date.now())
      }, EXTRACTION_CONFIG.idleDelayMs)
    }

    // Only cleanup on actual unmount, not on re-renders
    // We don't return a cleanup function here to prevent timer cancellation
  }, [status, displayMessages, currentScope.id, addMemories, setLastExtractionAt, ttsEnabled])

  // Separate cleanup effect that only runs on unmount
  useEffect(() => {
    return () => {
      if (extractionTimerRef.current && !extractionScheduledRef.current) {
        clearTimeout(extractionTimerRef.current)
      }
    }
  }, [])

  // Sync refs with latest values
  useEffect(() => {
    statusRef.current = status
    connectedRef.current = connected
    sendViaPortRef.current = sendViaPort
    currentScopeRef.current = currentScope
    sendMessageActionRef.current = sendMessageAction
  }, [status, connected, sendViaPort, currentScope, sendMessageAction])
  
  const handleSendMessage = useCallback(async (content: string) => {
    if (!content.trim() || statusRef.current === 'sending' || statusRef.current === 'streaming') return

    // Capture prefilled context before clearing it
    const selectedContext = prefilledContext
    const selectedSource = contextSource

    // Clear prefilled context immediately after capture
    setPrefilledContext(null)
    setContextSource(null)

    // Check if this is a vision/screenshot query
    const wantsVision = isVisionQuery(content)
    let screenshotBase64: string | null = null

    if (wantsVision) {
      log.log(' Vision query detected, capturing screenshot...')
      try {
        const response = await new Promise<{ success: boolean; screenshot?: string; error?: string }>((resolve) => {
          chrome.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT' }, resolve)
        })

        if (response.success && response.screenshot) {
          screenshotBase64 = response.screenshot
          log.log(' Screenshot captured successfully')
        } else {
          log.warn(' Screenshot capture failed:', response.error)
        }
      } catch (err) {
        log.warn(' Failed to capture screenshot:', err)
      }
    }

    // Get memory context for personalization
    const memoryStore = useMemoryStore.getState()
    const { context: memoryContext } = getMemoriesForPrompt(
      memoryStore.memories,
      { currentMessage: content },
      500 // Max tokens for memory context
    )

    // Extract page context for AI awareness
    let pageContext: string | undefined
    let pageType: string | undefined
    try {
      const extracted = await extractPageContext({ level: 2 })
      pageContext = buildContextForPrompt(extracted, 3000)
      pageType = extracted.type
      log.log(' Page context extracted:', { type: pageType, length: pageContext.length })
    } catch (err) {
      log.warn(' Failed to extract page context:', err)
    }

    // Create message in store first and get conversation history
    const history = await sendMessageActionRef.current(content, {
      url: window.location.href,
      title: document.title,
    })

    // Build selected context string for the prompt (from right-click context menu)
    let selectedContextStr: string | undefined
    if (selectedContext) {
      const sourceLabel = selectedSource === 'selection' ? 'Selected text' : 'Element content'
      selectedContextStr = `## ${sourceLabel} from page\n\n${selectedContext}`
      log.log(' Including selected context:', selectedContext.slice(0, 100) + '...')
    }

    // Send via port for streaming with conversation history and context
    if (connectedRef.current) {
      // If we have a screenshot, send as vision query; otherwise regular chat
      if (screenshotBase64) {
        // Send vision query with screenshot
        sendViaPortRef.current(currentScopeRef.current.id, content, {
          url: window.location.href,
          title: document.title,
          history,
          memoryContext: memoryContext || undefined,
          selectedContext: selectedContextStr,
          pageContext,  // Include page content for AI awareness
          pageType,
          screenshot: screenshotBase64,  // Include screenshot for vision
        })
      } else {
        // Regular chat with page context
        sendViaPortRef.current(currentScopeRef.current.id, content, {
          url: window.location.href,
          title: document.title,
          history,
          memoryContext: memoryContext || undefined,
          selectedContext: selectedContextStr,
          pageContext,  // Include page content for AI awareness
          pageType,
        })
      }
    } else {
      log.warn(' Port not connected, cannot stream')
    }
  }, [prefilledContext, contextSource])
  
  const handleClearThread = useCallback(async () => {
    if (confirm('Clear conversation from view? (Messages remain in history)')) {
      await useScopedChatStore.getState().clearCurrentThread()
    }
  }, [])
  
  const handleExportThread = useCallback(() => {
    const messages = displayMessages
    const dataStr = JSON.stringify({ 
      scope: currentScope, 
      messages,
      exportedAt: new Date().toISOString()
    }, null, 2)
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr)
    const exportFileDefaultName = `yumi-chat-${currentScope.origin}-${Date.now()}.json`
    
    const linkElement = document.createElement('a')
    linkElement.setAttribute('href', dataUri)
    linkElement.setAttribute('download', exportFileDefaultName)
    linkElement.click()
  }, [displayMessages, currentScope])
  
  const handleTogglePrivateMode = useCallback(() => {
    useScopedChatStore.getState().togglePrivateMode()
  }, [])

  // Don't render anything when collapsed - button is in native DOM
  if (!isExpanded) return null

  const hasMessages = displayMessages.length > 0
  const isStreaming = status === 'streaming' && streamingMessage !== null

  return (
    <>
    <div
        id="yumi-chat-overlay"
        className="glass-panel"
        style={{
          position: 'relative',
          width: `${CHAT.width}px`,
          height: `${CHAT.height}px`,
          borderRadius: `${CHAT.borderRadius}px`,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
          pointerEvents: 'auto',
          animation: 'yumiChatSlideIn 0.25s ease-out',
        }}
      >
        {/* Floating Menu (top-right) */}
        <ChatHeader
          connected={connected}
          privateMode={privateMode}
          onClearThread={handleClearThread}
          onExportThread={handleExportThread}
          onTogglePrivateMode={handleTogglePrivateMode}
        />

        {/* Messages area */}
        <div
          ref={containerRef}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: `${CHAT.padding}px`,
            paddingTop: `${CHAT.headerClearance}px`, // Space for floating menu
            scrollbarWidth: 'thin',
          }}
          className="yumi-chat-scroll"
        >
          {!hasMessages && !error && (
            <EmptyState
              onSuggestionClick={handleSendMessage}
              hasHistory={isCleared && historyCount > 0}
              historyCount={historyCount}
              historyLoading={historyLoading}
              onReloadHistory={reloadThread}
            />
          )}

          {displayMessages.map((m) => (
            <MessageBubble
              key={m.id}
              role={m.role as 'user' | 'assistant'}
              content={m.content}
              timestamp={m.ts}
              streaming={isStreaming && streamingMessage?.id === m.id}
              personality={m.role === 'assistant' ? {
                name: activePersonality?.name || 'Yumi',
                avatar: activePersonality?.avatar
              } : undefined}
            />
          ))}

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                style={{
                  margin: '8px 0',
                  padding: '10px 12px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.30)',
                  borderRadius: '10px',
                  fontSize: '13px',
                  color: '#fca5a5',
                }}
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Context Preview (from right-click menu) */}
        <AnimatePresence>
          {prefilledContext && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              style={{
                padding: '8px 12px',
                background: 'rgba(255, 255, 255, 0.10)',
                borderTop: '1px solid rgba(255, 255, 255, 0.10)',
                fontSize: '12px',
                color: 'rgba(255, 255, 255, 0.80)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                overflow: 'hidden',
              }}
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {contextSource === 'selection' ? '[Selected]' : '[Element]'} {prefilledContext.slice(0, 60)}...
              </span>
              <button
                onClick={() => {
                  setPrefilledContext(null)
                  setContextSource(null)
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '14px',
                  color: 'rgba(255, 255, 255, 0.50)',
                  padding: '2px 4px',
                }}
                title="Clear context"
              >
                x
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Message Input */}
        <MessageInput onSend={handleSendMessage} disabled={!connected || status === 'sending' || status === 'streaming'} />
      </div>

      {/* Expression Debug Panel - for tuning parameters (dev only) */}
      {SHOW_DEBUG_PANEL && ExpressionDebugPanel && (
        <React.Suspense fallback={null}>
          <ExpressionDebugPanel />
        </React.Suspense>
      )}
    </>
  )
}
