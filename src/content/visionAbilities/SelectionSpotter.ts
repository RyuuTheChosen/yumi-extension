import type { SelectionSpotterConfig } from '../../lib/types/visionConfig'
import { getSurroundingText, getAvatarPosition } from './utils'
import { getSelectionInputUI } from './SelectionInputUI'
import { sendPortMessage, getActivePort } from '../portManager'
import { getCurrentScope } from '../utils/scopes'
import { useScopedChatStore } from '../stores/scopedChat.store'
import type { Message } from '../utils/db'
import { bubbleManager, type VisionStage } from './FloatingResponseBubble'
import { createLogger } from '../../lib/debug'

const log = createLogger('SelectionSpotter')

export class SelectionSpotter {
  private config: SelectionSpotterConfig
  private debounceTimer: number | null = null
  private lastSelection: string = ''
  private lastSelectionObj: Selection | null = null
  private onSelectionChange = () => this.handleSelection()

  constructor(config: SelectionSpotterConfig) {
    this.config = config
    this.init()
  }

  private init() {
    if (!this.config.enabled) return

    document.addEventListener('selectionchange', this.onSelectionChange)
    log.log('✅ Initialized')
  }

  private handleSelection() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = window.setTimeout(() => {
      this.processSelection()
    }, this.config.debounceMs)
  }

  private async processSelection() {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return

    const selectedText = selection.toString().trim()

    // Guards
    if (selectedText.length < this.config.minSelectionLength) return
    if (selectedText.length > this.config.maxSelectionLength) {
      log.log('Selection too long, ignoring')
      return
    }
    if (selectedText === this.lastSelection) return

    // Ignore input fields
    if (this.config.ignoreInputFields) {
      const anchorNode = selection.anchorNode
      const parentElement = anchorNode?.parentElement
      if (parentElement && ['INPUT', 'TEXTAREA'].includes(parentElement.tagName)) {
        return
      }
    }

    this.lastSelection = selectedText
    this.lastSelectionObj = selection

    log.log('📝 Text selected:', selectedText.slice(0, 50))

    // Show interactive input UI instead of just an indicator
    this.showInputUI(selection, selectedText)
  }

  private showInputUI(selection: Selection, selectedText: string) {
    if (!selection.rangeCount) return

    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()

    const inputUI = getSelectionInputUI()
    
    inputUI.show({
      selectedText,
      position: {
        top: rect.top,
        left: rect.left,
      },
      onSubmit: (instruction: string) => {
        this.sendVisionQuery(selectedText, instruction)
      },
      onCancel: () => {
        log.log('User cancelled')
      },
    })
  }

  private sendVisionQuery(selectedText: string, instruction: string) {
    const requestId = crypto.randomUUID()
    const selection = this.lastSelectionObj
    const surrounding = selection ? getSurroundingText(selection) : ''
    const scope = getCurrentScope()

    log.log('🚀 Sending vision query with instruction:', instruction)
    
    // Build structured prompt using best practices
    const prompt = this.buildSelectionPrompt(selectedText, surrounding, instruction)
    
    // Create user message and assistant placeholder (same as regular chat flow)
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: `${instruction}\n\n> ${selectedText}`,
      ts: Date.now(),
      scopeId: scope.id,
      status: 'final'
    }
    
    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      ts: Date.now(),
      scopeId: scope.id,
      status: 'streaming'
    }
    
    // Add messages to store (using Zustand getState/setState directly since this is outside React)
    const store = useScopedChatStore.getState()
    const currentMessages = store.threads.get(scope.id) || []
    const updatedMessages = [...currentMessages, userMessage, assistantMessage]
    
    const newThreads = new Map(store.threads)
    newThreads.set(scope.id, updatedMessages)
    
    useScopedChatStore.setState({
      threads: newThreads,
      streamingMessage: assistantMessage,
      status: 'streaming',
      error: null
    })
    
    // Build conversation history for context (last 10 messages before new ones)
    const historyMessages = currentMessages.slice(-10).map(msg => ({
      role: msg.role,
      content: msg.content
    }))
    
    // === Create floating bubble above avatar (only if chat is closed) ===
    const avatarPos = getAvatarPosition()
    const bubble = avatarPos ? bubbleManager.create({
      position: { x: avatarPos.x, y: avatarPos.y },
      anchor: 'avatar',
      autoFadeMs: 10000
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
    
    // Send through port connection (same as regular chat)
    const success = sendPortMessage({
      type: 'VISION_QUERY',
      payload: {
        requestId,
        scopeId: scope.id,
        source: 'selection-spotter',
        prompt,
        history: historyMessages,
      },
    })

    if (success) {
      this.showBriefIndicator('Asking Yumi...')
    } else {
      this.showBriefIndicator('⚠️ Connection lost, try again')
      // Rollback on failure
      useScopedChatStore.setState({
        threads: new Map(store.threads),
        streamingMessage: null,
        status: 'error',
        error: 'Connection lost'
      })
    }
  }

  private buildSelectionPrompt(selectedText: string, surrounding: string, instruction: string): string {
    // Classify instruction type for optimized response
    const isTranslation = /translate|translation|language/i.test(instruction)
    const isSummary = /summarize|summary|tldr|brief/i.test(instruction)
    
    let context = ''
    if (surrounding && surrounding.length > 20) {
      context = `\n\nContext: "${surrounding.slice(0, 150)}..."`
    }
    
    // Task-specific framing
    let taskPrompt = instruction
    if (isTranslation) {
      taskPrompt = `Translate this text and explain any cultural nuances: ${instruction}`
    } else if (isSummary) {
      taskPrompt = `Summarize the key points: ${instruction}`
    }
    
    return `${taskPrompt}

Selected text: "${selectedText}"${context}

Respond in 2-3 sentences. Expand only if the topic is genuinely complex.`
  }

  private showBriefIndicator(text: string) {
    const indicator = document.createElement('div')
    indicator.id = 'yumi-selection-indicator'

    Object.assign(indicator.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      padding: '10px 14px',
      background: 'rgba(20, 20, 20, 0.90)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      color: 'rgba(255, 255, 255, 0.9)',
      fontSize: '13px',
      fontWeight: '600',
      borderRadius: '10px',
      zIndex: '2147483646',
      pointerEvents: 'none',
      animation: 'yumiVisionFadeIn 0.2s ease',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
      border: '1px solid rgba(255, 255, 255, 0.15)',
    })
    indicator.textContent = text

    document.body.appendChild(indicator)

    setTimeout(() => {
      indicator.style.animation = 'yumiVisionFadeOut 0.3s ease'
      setTimeout(() => indicator.remove(), 300)
    }, 2000)
  }

  destroy() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }
    document.removeEventListener('selectionchange', this.onSelectionChange)
    log.log('🧹 Cleaned up')
  }
}
