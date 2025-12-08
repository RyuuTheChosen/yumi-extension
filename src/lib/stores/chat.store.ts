import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { debouncedChromeStorage } from '../core/zustandChromeStorage'
import { redact } from '../crypto/redact'
import { usePersonalityStore } from './personality.store'
import { useSettingsStore } from './settings.store'
import { assembleSystemPrompt } from '../personality'

export type ChatRole = 'user' | 'assistant' | 'system'
export type ChatStatus = 'idle' | 'sending' | 'streaming' | 'error' | 'canceled' | 'retrying'
export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  timestamp: number
}

const MAX_MESSAGES = 100

function trimAndValidate(list: ChatMessage[]): ChatMessage[] {
  const valid = (list ?? []).filter(
    (m) =>
      m &&
      typeof m.id === 'string' &&
      (m.role === 'user' || m.role === 'assistant' || m.role === 'system') &&
      typeof m.content === 'string' &&
      typeof m.timestamp === 'number'
  )

  let system: ChatMessage | undefined
  const rest: ChatMessage[] = []
  for (const msg of valid) {
    if (!system && msg.role === 'system') system = msg
    else rest.push(msg)
  }
  const trimmed = rest.slice(-MAX_MESSAGES)
  return system ? [system, ...trimmed] : trimmed
}

interface ChatStore {
  messages: ChatMessage[]
  status: ChatStatus
  error?: string | null
  requestId?: string
  attempt: number
  maxAttempts: number
  cancelActive: () => void
  retryLast: () => void
  sendMessage: (text: string) => void
  appendChunk: (chunk: string) => void
  finalizeAssistantMessage: () => void
  setError: (msg: string | null) => void
  clearHistory: () => Promise<void>
  setMessages: (next: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      messages: [],
      status: 'idle',
      error: null,
      requestId: undefined,
      attempt: 0,
      maxAttempts: 3,
      setMessages: (next: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
        const nextList = typeof next === 'function' ? (next as any)(get().messages) : next
        set({ messages: trimAndValidate(nextList as ChatMessage[]) })
      },
      clearHistory: async () => {
        // Reset personality to latest default when clearing history
        try {
          usePersonalityStore.getState().resetToDefault()
        } catch (e) {
          // Silent failure - personality reset is optional
        }
        set({ messages: [], status: 'idle', error: null, requestId: undefined, attempt: 0 })
      },
      sendMessage: (text: string) => {
        const { status } = get()
        if (!text.trim() || status === 'sending' || status === 'streaming') return
        const user: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text, timestamp: Date.now() }
        const assistant: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '', timestamp: Date.now() }
        const requestId = crypto.randomUUID()
        set({ messages: trimAndValidate([...get().messages, user, assistant]), status: 'sending', error: null, requestId, attempt: 1 })
        const system = get().messages.find(m => m.role === 'system')
        // Determine active personality prompt (fallback to default)
        let systemPrompt = 'You are Yumi, a privacy-first web companion.'
        try {
          const pState = usePersonalityStore.getState()
          const active = pState.list.find(p => p.id === pState.activeId) || pState.list[0]
          if (active) systemPrompt = assembleSystemPrompt(active)
        } catch {}
        const base = system ? get().messages : [
          { id: crypto.randomUUID(), role: 'system', content: systemPrompt, timestamp: Date.now() },
          ...get().messages
        ]
        const redactedUser = { role: 'user' as const, content: redact(text) }
        // Hub-only: all requests route through Hub API
        const payloadMessages = [...base.map(m => ({ role: m.role, content: m.content })), redactedUser]
        const { model } = useSettingsStore.getState()
        chrome.runtime.sendMessage({ type: 'query', payload: { messages: payloadMessages, model: model || 'gpt-4o-mini', requestId, maxAttempts: get().maxAttempts } })
        set({ status: 'streaming' })
      },
      cancelActive: () => {
        const { status, requestId } = get()
        if (status !== 'streaming' && status !== 'sending') return
        if (requestId) {
          chrome.runtime.sendMessage({ type: 'query:abort', payload: { requestId } })
        }
        set({ status: 'canceled' })
      },
      retryLast: () => {
        const { status, messages } = get()
        if (status !== 'error') return
        const lastUser = [...messages].reverse().find(m => m.role === 'user')
        if (!lastUser) return
        // Preserve existing assistant attempt; append a new assistant message for the retry
        const assistant: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '', timestamp: Date.now() }
        const requestId = crypto.randomUUID()
        set({ messages: trimAndValidate([...messages, assistant]), status: 'sending', error: null, requestId, attempt: get().attempt + 1 })
        // Re-dispatch with same logic as sendMessage but without adding another user
        const system = get().messages.find(m => m.role === 'system')
        let systemPrompt = 'You are Yumi, a privacy-first web companion.'
        try {
          const pState = usePersonalityStore.getState()
          const active = pState.list.find(p => p.id === pState.activeId) || pState.list[0]
          if (active) systemPrompt = assembleSystemPrompt(active)
        } catch {}
        const base = system ? get().messages : [
          { id: crypto.randomUUID(), role: 'system', content: systemPrompt, timestamp: Date.now() },
          ...get().messages
        ]
        const redactedUser = { role: 'user' as const, content: redact(lastUser.content) }
        // Hub-only: all requests route through Hub API
        const payloadMessages = [...base.map(m => ({ role: m.role, content: m.content })), redactedUser]
        const { model } = useSettingsStore.getState()
        chrome.runtime.sendMessage({ type: 'query', payload: { messages: payloadMessages, model: model || 'gpt-4o-mini', requestId, maxAttempts: get().maxAttempts } })
        set({ status: 'streaming' })
      },
      appendChunk: (chunk: string) => {
        if (!chunk) return
        const msgs = [...get().messages]
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i]
          if (m.role === 'assistant') {
            m.content += chunk
            break
          }
        }
        set({ messages: trimAndValidate(msgs) })
      },
      finalizeAssistantMessage: () => {
        const { status } = get()
        if (status === 'streaming' || status === 'sending' || status === 'retrying') {
          set({ status: 'idle' })
        }
      },
      setError: (msg: string | null) => {
        set({ error: msg, status: msg ? 'error' : get().status })
      }
    }),
    {
      name: 'chat-store',
      storage: createJSONStorage(() => debouncedChromeStorage),
      partialize: (s) => ({ messages: s.messages }),
      version: 1,
    }
  )
)
