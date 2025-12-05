/**
 * Proactive Memory Hook
 *
 * Manages the proactive memory system that initiates conversations based on context.
 * Handles welcome messages, follow-ups, context matching, and random recall.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { createLogger } from '../../lib/debug'
import { bus, type PageReadyContext } from '../../lib/bus'
import { ttsService } from '../../lib/tts'
import { useScopedChatStore } from '../stores/scopedChat.store'
import { useMemoryStore } from '../../lib/memory'
import {
  ProactiveMemoryController,
  type ProactiveAction,
  detectPageType,
} from '../../lib/memory'
import { bubbleManager } from '../visionAbilities/FloatingResponseBubble'
import { isChatOverlayOpen } from '../chatState'
import { getAvatarPosition } from '../visionAbilities/utils'
import { setChatOpen } from '../chatState'
import type { Memory } from '../../lib/memory/types'

const log = createLogger('useProactiveMemory')

export interface UseProactiveMemoryOptions {
  enabled: boolean
  followUpEnabled: boolean
  contextMatchEnabled: boolean
  randomRecallEnabled: boolean
  welcomeBackEnabled: boolean
  cooldownMinutes: number
  maxPerSession: number
  memoriesLoaded: boolean
  memories: Memory[]
  ttsEnabled: boolean
  setIsExpanded: (expanded: boolean) => void
  onToggle?: (isOpen: boolean) => void
}

export interface UseProactiveMemoryReturn {
  proactiveAction: ProactiveAction | null
  setProactiveAction: (action: ProactiveAction | null) => void
  showProactiveMessage: (action: ProactiveAction) => Promise<void>
  handleProactiveEngaged: () => Promise<void>
}

/**
 * Custom hook for proactive memory system
 *
 * Initializes ProactiveMemoryController and manages proactive actions:
 * - Welcome back messages on session start
 * - Follow-up questions based on previous conversations
 * - Context-aware messages based on current page
 * - Random memory recall to keep context fresh
 * - Periodic checks every cooldown period
 */
export function useProactiveMemory(options: UseProactiveMemoryOptions): UseProactiveMemoryReturn {
  const {
    enabled,
    followUpEnabled,
    contextMatchEnabled,
    randomRecallEnabled,
    welcomeBackEnabled,
    cooldownMinutes,
    maxPerSession,
    memoriesLoaded,
    memories,
    ttsEnabled,
    setIsExpanded,
    onToggle
  } = options

  const [proactiveAction, setProactiveAction] = useState<ProactiveAction | null>(null)
  const proactiveControllerRef = useRef<ProactiveMemoryController | null>(null)
  const updateImportance = useMemoryStore(s => s.updateImportance)

  /**
   * Initialize proactive controller once memories are loaded
   */
  useEffect(() => {
    if (!memoriesLoaded) return

    const controller = new ProactiveMemoryController({
      enabled,
      followUpEnabled,
      contextMatchEnabled,
      randomRecallEnabled,
      welcomeBackEnabled,
      cooldownMinutes,
      maxPerSession,
    })

    controller.initialize().then(async () => {
      proactiveControllerRef.current = controller
      log.log('[useProactiveMemory] Proactive controller initialized')

      if (enabled) {
        const pageContext: PageReadyContext = {
          url: window.location.href,
          origin: window.location.origin,
          title: document.title,
          pageType: detectPageType(window.location.href, document.title),
        }

        const action = await controller.getProactiveAction(memories, pageContext, true)
        if (action) {
          log.log('[useProactiveMemory] Proactive action on session start:', action.type)
          setProactiveAction(action)
        }
      }
    })

    return () => {
      proactiveControllerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoriesLoaded])

  /**
   * Update controller config when settings change
   */
  useEffect(() => {
    if (proactiveControllerRef.current) {
      proactiveControllerRef.current.updateConfig({
        enabled,
        followUpEnabled,
        contextMatchEnabled,
        randomRecallEnabled,
        welcomeBackEnabled,
        cooldownMinutes,
        maxPerSession,
      })
    }
  }, [
    enabled,
    followUpEnabled,
    contextMatchEnabled,
    randomRecallEnabled,
    welcomeBackEnabled,
    cooldownMinutes,
    maxPerSession,
  ])

  /**
   * Periodic proactive check every cooldown period
   */
  useEffect(() => {
    if (!enabled || !proactiveControllerRef.current) return

    const intervalMs = cooldownMinutes * 60 * 1000

    const checkProactive = async () => {
      if (!proactiveControllerRef.current || proactiveAction) return

      const pageContext: PageReadyContext = {
        url: window.location.href,
        origin: window.location.origin,
        title: document.title,
        pageType: detectPageType(window.location.href, document.title),
      }

      const action = await proactiveControllerRef.current.getProactiveAction(memories, pageContext)
      if (action) {
        log.log('[useProactiveMemory] Proactive action (periodic):', action.type)
        setProactiveAction(action)
      }
    }

    const interval = setInterval(checkProactive, intervalMs)

    return () => clearInterval(interval)
  }, [enabled, cooldownMinutes, proactiveAction, memories])

  /**
   * Display proactive action when triggered
   */
  useEffect(() => {
    if (!proactiveAction || !proactiveControllerRef.current) return

    const displayProactive = async () => {
      proactiveControllerRef.current?.recordProactive(proactiveAction.memory?.id, proactiveAction)

      if (!isChatOverlayOpen()) {
        const avatarPos = getAvatarPosition()
        if (avatarPos) {
          const requestId = `proactive-${Date.now()}`
          const bubble = bubbleManager.create({
            position: { x: avatarPos.x, y: avatarPos.y },
            anchor: 'avatar',
            autoFadeMs: 15000,
          }, requestId)

          if (bubble) {
            bubble.appendChunk(proactiveAction.message)
            bubble.finalize()
            log.log('[useProactiveMemory] Proactive bubble displayed:', proactiveAction.type)
          }
        }
      } else {
        const store = useScopedChatStore.getState()
        await store.addProactiveMessage(proactiveAction.message)
        log.log('[useProactiveMemory] Proactive message added to chat:', proactiveAction.type)
      }

      if (ttsEnabled) {
        ttsService.speak(proactiveAction.message)
        bus.emit('avatar', { type: 'speaking:start' })
      }

      bus.emit('proactive:triggered', {
        type: proactiveAction.type,
        message: proactiveAction.message,
        memoryId: proactiveAction.memory?.id,
      })
    }

    displayProactive()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proactiveAction, ttsEnabled])

  /**
   * Show proactive message in chat and expand overlay
   */
  const showProactiveMessage = useCallback(async (action: ProactiveAction) => {
    if (!proactiveControllerRef.current) return

    proactiveControllerRef.current.recordProactive(action.memory?.id)

    const store = useScopedChatStore.getState()
    await store.addProactiveMessage(action.message)

    setIsExpanded(true)
    setChatOpen(true)
    onToggle?.(true)

    setProactiveAction(action)

    log.log('[useProactiveMemory] Proactive message shown:', action.type)
    bus.emit('proactive:triggered', {
      type: action.type,
      message: action.message,
      memoryId: action.memory?.id,
    })
  }, [setIsExpanded, onToggle])

  /**
   * Mark proactive as engaged when user responds
   */
  const handleProactiveEngaged = useCallback(async () => {
    if (!proactiveAction || !proactiveControllerRef.current) return

    const memoryId = proactiveAction.memory?.id
    if (memoryId) {
      proactiveControllerRef.current.recordFeedback(memoryId, 'engaged')
      await updateImportance(memoryId, 0.1)
      bus.emit('proactive:engaged', memoryId)
      log.log('[useProactiveMemory] Proactive engaged:', proactiveAction.type)
    }

    setProactiveAction(null)
  }, [proactiveAction, updateImportance])

  return {
    proactiveAction,
    setProactiveAction,
    showProactiveMessage,
    handleProactiveEngaged
  }
}
