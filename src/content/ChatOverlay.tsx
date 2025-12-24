import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import ReactDOM from 'react-dom/client'
import { motion, AnimatePresence } from 'framer-motion'
import { createLogger } from '../lib/core/debug'
import { CHAT } from '../lib/design/dimensions'
import { useScopedChatStore } from './stores/scopedChat.store'
import { usePersonalityStore } from '../lib/stores/personality.store'
import { useSettingsStore } from '../lib/stores/settings.store'
import { usePortConnection } from './hooks/usePortConnection'
import { useTTS } from './hooks/useTTS'
import { useSTT } from './hooks/useSTT'
import { useMemoryExtraction } from './hooks/useMemoryExtraction'
import { useWebSearch } from './hooks/useWebSearch'
import { useProactiveMemory } from './hooks/useProactiveMemory'
import { useContextMenu } from './hooks/useContextMenu'
import { ChatHeader } from './components/ChatHeader'
import { MessageBubble } from './components/MessageBubble'
import { MessageInput, type MessageInputHandle } from './components/MessageInput'
import { EmptyState } from './components/EmptyState'
import { HydrationGate } from './components/HydrationGate'
import { getThreadMessages } from './utils/db'
import { setChatOpen } from './chatState'
import {
  useMemoryStore,
  getMemoriesForPrompt,
  migrateLocalMemories,
} from '../lib/memory'
import { checkPluginTriggers, isPluginActive } from '../lib/plugins/loader'
import { extractPageContext, buildContextForPrompt } from '../lib/context'
import { formatSearchResultsForPrompt, shouldSuggestSearch, type SearchResult } from '../lib/search'
import { Loader2 } from 'lucide-react'

const log = createLogger('ChatOverlay')

declare const __DEV__: boolean
const ExpressionDebugPanel = __DEV__
  ? React.lazy(() => import('./components/ExpressionDebugPanel').then(m => ({ default: m.ExpressionDebugPanel })))
  : null
const SHOW_DEBUG_PANEL = __DEV__ && false

interface ChatOverlayProps {
  chatButton?: HTMLButtonElement
  onToggle?: (isOpen: boolean) => void
}

/**
 * Chat Overlay Component
 *
 * Main chat UI integrated into overlay with scoped conversation threads,
 * port-based streaming, and IndexedDB persistence.
 *
 * Refactored to use custom hooks for TTS, STT, memory extraction,
 * web search, proactive memory, and context menu integration.
 */
export const ChatOverlay: React.FC<ChatOverlayProps> = ({ chatButton, onToggle }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [historyCount, setHistoryCount] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(false)
  const messageInputRef = useRef<MessageInputHandle | null>(null)

  const currentScope = useScopedChatStore(s => s.currentScope)
  const threads = useScopedChatStore(s => s.threads)
  const streamingMessage = useScopedChatStore(s => s.streamingMessage)
  const status = useScopedChatStore(s => s.status)
  const error = useScopedChatStore(s => s.error)
  const isCleared = useScopedChatStore(s => s.isCleared)
  const sendMessageAction = useScopedChatStore(s => s.sendMessage)
  const reloadThread = useScopedChatStore(s => s.reloadThread)
  const privateMode = useScopedChatStore(s => s.privateMode)

  const displayMessages = useMemo(() => {
    const threadMessages = threads.get(currentScope.id) || []
    if (streamingMessage && !threadMessages.find(m => m.id === streamingMessage.id)) {
      return [...threadMessages, streamingMessage]
    }
    return threadMessages
  }, [threads, currentScope.id, streamingMessage])

  const activePersonality = usePersonalityStore(s => {
    const id = s.activeId
    return s.list.find(p => p.id === id)
  })
  const ensureDefaultPersonality = usePersonalityStore(s => s.ensureDefault)

  const memories = useMemoryStore(s => s.memories)
  const memoriesLoaded = useMemoryStore(s => s.isLoaded)
  const loadMemories = useMemoryStore(s => s.loadMemories)

  const ttsEnabled = useSettingsStore(s => s.ttsEnabled)
  const ttsVolume = useSettingsStore(s => s.ttsVolume)
  const activeCompanionSlug = useSettingsStore(s => s.activeCompanionSlug)
  const hubUrl = useSettingsStore(s => s.hubUrl)
  const hubAccessToken = useSettingsStore(s => s.hubAccessToken)

  const proactiveEnabled = useSettingsStore(s => s.proactiveEnabled)
  const proactiveFollowUp = useSettingsStore(s => s.proactiveFollowUp)
  const proactiveContext = useSettingsStore(s => s.proactiveContext)
  const proactiveRandom = useSettingsStore(s => s.proactiveRandom)
  const proactiveWelcomeBack = useSettingsStore(s => s.proactiveWelcomeBack)
  const proactiveCooldownMins = useSettingsStore(s => s.proactiveCooldownMins)
  const proactiveMaxPerSession = useSettingsStore(s => s.proactiveMaxPerSession)
  const autoSearchEnabled = useSettingsStore(s => s.autoSearchEnabled)

  const { connected, sendViaPort } = usePortConnection()

  const statusRef = useRef(status)
  const connectedRef = useRef(connected)
  const sendViaPortRef = useRef(sendViaPort)
  const currentScopeRef = useRef(currentScope)
  const sendMessageActionRef = useRef(sendMessageAction)

  /**
   * Custom Hooks Integration
   */
  const { streamingTtsRef, streamingTtsFailedRef } = useTTS({
    enabled: ttsEnabled,
    volume: ttsVolume,
    activeCompanionSlug,
    hubUrl,
    hubAccessToken,
    status
  })

  useSTT({
    messageInputRef,
    isExpanded,
    setIsExpanded,
    onToggle
  })

  useMemoryExtraction({
    status,
    displayMessages,
    currentScopeId: currentScope.id,
  })

  const [searchActive, setSearchActive] = useState(false)

  const {
    isSearching,
    searchError,
    messageSources,
    pendingSourcesRef,
    performSearchForMessage,
    clearError: clearSearchError,
    retrySearch,
    setMessageSources
  } = useWebSearch({
    status,
    displayMessages,
  })

  const {
    proactiveAction,
    setProactiveAction,
    showProactiveMessage,
    handleProactiveEngaged
  } = useProactiveMemory({
    enabled: proactiveEnabled,
    followUpEnabled: proactiveFollowUp,
    contextMatchEnabled: proactiveContext,
    randomRecallEnabled: proactiveRandom,
    welcomeBackEnabled: proactiveWelcomeBack,
    cooldownMinutes: proactiveCooldownMins,
    maxPerSession: proactiveMaxPerSession,
    memoriesLoaded,
    memories,
    ttsEnabled,
    setIsExpanded,
    onToggle
  })

  const {
    prefilledContext,
    contextSource,
    setPrefilledContext,
    setContextSource
  } = useContextMenu({
    setIsExpanded,
    onToggle
  })

  /**
   * Connect to native chat button
   */
  useEffect(() => {
    if (!chatButton) return

    const handleClick = () => {
      const newState = !isExpanded
      setIsExpanded(newState)
      setChatOpen(newState)
      onToggle?.(newState)
    }

    chatButton.addEventListener('click', handleClick)
    return () => chatButton.removeEventListener('click', handleClick)
  }, [chatButton, isExpanded, onToggle])

  /**
   * Ensure default personality exists
   */
  useEffect(() => {
    ensureDefaultPersonality()
  }, [ensureDefaultPersonality])

  /**
   * Migrate and load memories on mount
   */
  useEffect(() => {
    if (!memoriesLoaded) {
      migrateLocalMemories()
        .then((count) => {
          if (count > 0) {
            log.log(`[ChatOverlay] Migrated ${count} memories from local storage`)
          }
          return loadMemories()
        })
        .then(() => {
          log.log('[ChatOverlay] Memories loaded')
        })
        .catch((err) => {
          log.error('[ChatOverlay] Memory load failed:', err)
        })
    }
  }, [memoriesLoaded, loadMemories])

  /**
   * Check for history when chat is cleared
   */
  useEffect(() => {
    if (isCleared && displayMessages.length === 0) {
      setHistoryLoading(true)
      getThreadMessages(currentScope.id)
        .then((msgs) => {
          setHistoryCount(msgs.length)
        })
        .catch((err) => {
          log.error('[ChatOverlay] Failed to check history:', err)
        })
        .finally(() => {
          setHistoryLoading(false)
        })
    }
  }, [isCleared, displayMessages.length, currentScope.id])

  /**
   * Auto-scroll to bottom on new messages
   */
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [displayMessages])

  /**
   * Sync refs with latest values
   */
  useEffect(() => {
    statusRef.current = status
    connectedRef.current = connected
    sendViaPortRef.current = sendViaPort
    currentScopeRef.current = currentScope
    sendMessageActionRef.current = sendMessageAction
  }, [status, connected, sendViaPort, currentScope, sendMessageAction])

  /**
   * Thinking animation state management
   *
   * Shows thinking animation while waiting for AI response.
   * - Start: when status becomes 'sending' (waiting for response)
   * - Stop: when status becomes 'streaming' (AI starts responding)
   * - Stop: when status becomes 'idle' or 'error' (response complete/failed)
   */
  useEffect(() => {
    const thinkingAPI = window.__yumiThinking
    if (!thinkingAPI) return

    if (status === 'sending') {
      thinkingAPI.start()
    } else if (status === 'streaming' || status === 'idle' || status === 'error') {
      thinkingAPI.stop()
    }
  }, [status])

  /**
   * Record user interactions to reset idle timer
   */
  useEffect(() => {
    if (isExpanded) {
      window.__yumiEmotion?.recordInteraction()
    }
  }, [isExpanded, displayMessages.length])

  /**
   * Core message sending function
   */
  const doSendMessage = useCallback(async (content: string, searchResults?: SearchResult[]) => {
    if (!content.trim() || statusRef.current === 'sending' || statusRef.current === 'streaming') return

    const selectedContext = prefilledContext
    const selectedSource = contextSource

    setPrefilledContext(null)
    setContextSource(null)

    const trigger = checkPluginTriggers(content)
    const wantsVision = trigger?.pluginId === 'vision' && trigger?.data?.needsScreenshot
    let screenshotBase64: string | null = null

    if (wantsVision && isPluginActive('vision')) {
      log.log('[ChatOverlay] Vision query detected via plugin, capturing screenshot...')
      try {
        const response = await new Promise<{ success: boolean; screenshot?: string; error?: string }>((resolve) => {
          chrome.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT' }, resolve)
        })

        if (response.success && response.screenshot) {
          screenshotBase64 = response.screenshot
          log.log('[ChatOverlay] Screenshot captured successfully')
        } else {
          log.warn('[ChatOverlay] Screenshot capture failed:', response.error)
        }
      } catch (err) {
        log.warn('[ChatOverlay] Failed to capture screenshot:', err)
      }
    }

    const memoryStore = useMemoryStore.getState()
    const { context: memoryContext } = getMemoriesForPrompt(
      memoryStore.memories,
      { currentMessage: content },
      500
    )

    let pageType: string | undefined
    let pageContent: string | undefined
    try {
      const extracted = await extractPageContext({ level: 2 })
      pageType = extracted.type
      pageContent = buildContextForPrompt(extracted, 2000)
      log.log('[ChatOverlay] Page context extracted:', pageType, pageContent?.slice(0, 100))
    } catch (err) {
      log.warn('[ChatOverlay] Failed to extract page context:', err)
    }

    const history = await sendMessageActionRef.current(content, {
      url: window.location.href,
      title: document.title,
    })

    let selectedContextStr: string | undefined
    if (selectedContext) {
      const sourceLabel = selectedSource === 'selection' ? 'Selected text' : 'Element content'
      selectedContextStr = `## ${sourceLabel} from page\n\n${selectedContext}`
      log.log('[ChatOverlay] Including selected context:', selectedContext.slice(0, 100) + '...')
    }

    let searchContextStr: string | undefined
    if (searchResults && searchResults.length > 0) {
      searchContextStr = formatSearchResultsForPrompt(searchResults)
      log.log('[ChatOverlay] Including search context:', searchResults.length, 'results')
      pendingSourcesRef.current = searchResults
    }

    if (connectedRef.current) {
      if (screenshotBase64) {
        sendViaPortRef.current(currentScopeRef.current.id, content, {
          url: window.location.href,
          title: document.title,
          history,
          memoryContext: memoryContext || undefined,
          selectedContext: selectedContextStr,
          searchContext: searchContextStr,
          pageType,
          pageContent,
          screenshot: screenshotBase64,
        })
      } else {
        sendViaPortRef.current(currentScopeRef.current.id, content, {
          url: window.location.href,
          title: document.title,
          history,
          memoryContext: memoryContext || undefined,
          selectedContext: selectedContextStr,
          searchContext: searchContextStr,
          pageType,
          pageContent,
        })
      }
    } else {
      log.warn('[ChatOverlay] Port not connected, cannot stream')
    }
  }, [prefilledContext, contextSource, setPrefilledContext, setContextSource, pendingSourcesRef])

  /**
   * Callback functions
   */
  const handleSendMessage = useCallback(async (content: string) => {
    if (!content.trim() || statusRef.current === 'sending' || statusRef.current === 'streaming') return

    const searchPluginActive = isPluginActive('search')
    const shouldAutoSearch = autoSearchEnabled && searchPluginActive && shouldSuggestSearch(content)

    if (searchActive || shouldAutoSearch) {
      setSearchActive(false)
      if (shouldAutoSearch && !searchActive) {
        log.log('[ChatOverlay] Auto-search triggered for query:', content.slice(0, 50))
      }
      const results = await performSearchForMessage(content)
      if (results && results.length > 0) {
        pendingSourcesRef.current = results
        await doSendMessage(content, results)
      } else {
        await doSendMessage(content)
      }
    } else {
      await doSendMessage(content)
    }
  }, [searchActive, autoSearchEnabled, performSearchForMessage, doSendMessage, pendingSourcesRef])

  const handleSearchToggle = useCallback(() => {
    setSearchActive(prev => !prev)
  }, [])

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

  /**
   * Render
   */
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
        <ChatHeader
          connected={connected}
          privateMode={privateMode}
          onClearThread={handleClearThread}
          onExportThread={handleExportThread}
          onTogglePrivateMode={handleTogglePrivateMode}
        />

        <div
          ref={containerRef}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: `${CHAT.padding}px`,
            paddingTop: `${CHAT.headerClearance}px`,
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
              sources={m.role === 'assistant' ? messageSources.get(m.id) : undefined}
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

          <AnimatePresence>
            {isSearching && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                style={{
                  margin: '8px 0',
                  padding: '10px 12px',
                  background: 'rgba(59, 130, 246, 0.15)',
                  border: '1px solid rgba(59, 130, 246, 0.30)',
                  borderRadius: '10px',
                  fontSize: '13px',
                  color: '#93c5fd',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <Loader2 size={14} className="animate-spin" />
                <span>Searching web...</span>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {searchError && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                style={{
                  margin: '8px 0',
                  padding: '10px 12px',
                  background: 'rgba(251, 191, 36, 0.15)',
                  border: '1px solid rgba(251, 191, 36, 0.30)',
                  borderRadius: '10px',
                  fontSize: '13px',
                  color: '#fde047',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                }}
              >
                <span>{searchError.message}</span>
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  <button
                    onClick={async () => {
                      const results = await retrySearch()
                      if (results && results.length > 0) {
                        pendingSourcesRef.current = results
                      }
                    }}
                    style={{
                      background: 'rgba(251, 191, 36, 0.25)',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '4px 10px',
                      color: '#fde047',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    Retry
                  </button>
                  <button
                    onClick={clearSearchError}
                    style={{
                      background: 'rgba(251, 191, 36, 0.15)',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '4px 10px',
                      color: '#fde047',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {prefilledContext && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                style={{
                  margin: '8px 0',
                  padding: '10px 12px',
                  background: 'rgba(139, 92, 246, 0.15)',
                  border: '1px solid rgba(139, 92, 246, 0.30)',
                  borderRadius: '10px',
                  fontSize: '13px',
                  color: '#c4b5fd',
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: '8px',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, marginBottom: '4px' }}>
                    {contextSource === 'selection' ? 'Selected text' : 'Element content'}
                  </div>
                  <div style={{ opacity: 0.8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {prefilledContext.slice(0, 100)}...
                  </div>
                </div>
                <button
                  onClick={() => {
                    setPrefilledContext(null)
                    setContextSource(null)
                  }}
                  style={{
                    background: 'rgba(139, 92, 246, 0.20)',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    color: '#c4b5fd',
                    cursor: 'pointer',
                    fontSize: '12px',
                    flexShrink: 0,
                  }}
                >
                  Clear
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <MessageInput
          ref={messageInputRef}
          onSend={handleSendMessage}
          disabled={!connected || status === 'streaming'}
          placeholder={connected ? 'Message...' : 'Connecting...'}
          onProactiveEngaged={handleProactiveEngaged}
          searchProps={{
            available: isPluginActive('search'),
            active: searchActive,
            isSearching,
            onToggle: handleSearchToggle,
          }}
        />
      </div>

      {SHOW_DEBUG_PANEL && ExpressionDebugPanel && (
        <React.Suspense fallback={null}>
          <ExpressionDebugPanel />
        </React.Suspense>
      )}
    </>
  )
}

/**
 * Mount the ChatOverlay into a shadow root
 */
export function mountChatOverlay(shadowRoot: ShadowRoot, chatButton?: HTMLButtonElement): void {
  /** Trigger store rehydration from chrome.storage (required when skipHydration: true) */
  useSettingsStore.persist.rehydrate()
  usePersonalityStore.persist.rehydrate()

  /** Inject stylesheet into shadow DOM (CSS doesn't penetrate shadow boundaries) */
  const styleLink = document.createElement('link')
  styleLink.rel = 'stylesheet'
  styleLink.href = chrome.runtime.getURL('style.css')
  shadowRoot.appendChild(styleLink)

  /** Add Google Fonts for proper typography */
  const fontLink = document.createElement('link')
  fontLink.rel = 'stylesheet'
  fontLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
  shadowRoot.appendChild(fontLink)

  const mountPoint = document.createElement('div')
  mountPoint.id = 'yumi-chat-root'
  shadowRoot.appendChild(mountPoint)

  const root = ReactDOM.createRoot(mountPoint)
  root.render(
    <React.StrictMode>
      <HydrationGate>
        <ChatOverlay chatButton={chatButton} />
      </HydrationGate>
    </React.StrictMode>
  )
}
