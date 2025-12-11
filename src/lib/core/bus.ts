import { createNanoEvents } from 'nanoevents'
import type { YumiError } from './errors'

// Typed avatar states (expand later as needed)
export type AvatarEvent =
  | { type: 'thinking:start' }
  | { type: 'thinking:stop' }
  | { type: 'speaking:start' }
  | { type: 'speaking:stop' }

// Page context for proactive system
export interface PageReadyContext {
  url: string
  origin: string
  title: string
  pageType?: 'code' | 'article' | 'social' | 'shopping' | 'video' | 'other'
}

// Proactive action type for events
export interface ProactiveActionEvent {
  type: 'welcome_back' | 'follow_up' | 'context_match' | 'random_recall'
  message: string
  memoryId?: string
}

// Extended event map for streaming lifecycle
interface EventMap {
  stream: (delta: string, meta?: { requestId?: string }) => void
  streamEnd: (meta?: { requestId?: string }) => void
  streamError: (error: YumiError) => void
  streamRetry: (info: { attempt: number; nextDelayMs: number; requestId?: string }) => void
  streamCancel: (meta?: { requestId?: string }) => void
  avatar: (payload: AvatarEvent) => void
  'plugins:loaded': (plugins: string[]) => void
  // Companion events
  'companion:loading': (slug: string) => void
  'companion:changed': (companion: unknown) => void
  'companion:error': (error: { message: string; slug?: string }) => void
  // Proactive system events
  'page:ready': (context: PageReadyContext) => void
  'proactive:triggered': (action: ProactiveActionEvent) => void
  'proactive:engaged': (memoryId: string) => void
  'proactive:dismissed': (memoryId: string) => void
  'proactive:ignored': (memoryId: string) => void
}

const nano = createNanoEvents<EventMap>()

/**
 * Subscription tracking for memory leak prevention
 * WeakMap allows garbage collection of callbacks when no longer referenced
 */
const subscriptions = new WeakMap<Function, () => void>()
const allUnsubscribers: Array<() => void> = []

export const bus = {
  /**
   * Subscribe to an event
   * @returns Unsubscribe function - MUST be called to prevent memory leaks
   */
  on<E extends keyof EventMap>(event: E, cb: EventMap[E]) {
    const unsub = nano.on(event, cb as any)

    // Track subscription for cleanup
    subscriptions.set(cb, unsub)
    allUnsubscribers.push(unsub)

    // Return enhanced unsubscribe that also removes from tracking
    return () => {
      unsub()
      subscriptions.delete(cb)
      const index = allUnsubscribers.indexOf(unsub)
      if (index > -1) allUnsubscribers.splice(index, 1)
    }
  },

  emit<E extends keyof EventMap>(event: E, ...args: Parameters<EventMap[E]>) {
    nano.emit(event, ...(args as any))
  },

  /**
   * Emergency cleanup - unsubscribe all listeners
   * Use only when absolutely necessary (e.g., critical error state)
   */
  cleanup() {
    allUnsubscribers.forEach(unsub => unsub())
    allUnsubscribers.length = 0
  }
}

// Shim runtime messages into typed bus events
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case 'stream:delta': // legacy
    case 'STREAM_CHUNK':
      bus.emit('stream', String(msg.payload?.chunk ?? msg.payload), { requestId: msg.payload?.requestId })
      break
    case 'stream:end': // legacy
    case 'STREAM_DONE':
      bus.emit('streamEnd', { requestId: msg.payload?.requestId })
      break
    case 'STREAM_ERROR':
      if (msg.payload && typeof msg.payload === 'object') {
        bus.emit('streamError', msg.payload as YumiError)
      } else {
        bus.emit('streamError', { category: 'unknown', message: String(msg.payload || 'Error'), retriable: false, attempt: 1, maxAttempts: 1, timestamp: Date.now() })
      }
      break
    case 'STREAM_RETRY':
      bus.emit('streamRetry', { attempt: msg.payload?.attempt, nextDelayMs: msg.payload?.nextDelayMs, requestId: msg.payload?.requestId })
      break
    case 'STREAM_CANCELLED':
      bus.emit('streamCancel', { requestId: msg.payload?.requestId })
      break
    case 'avatar':
      if (msg.payload && typeof msg.payload.type === 'string') {
        bus.emit('avatar', msg.payload as AvatarEvent)
      }
      break
    default:
      break
  }
})

