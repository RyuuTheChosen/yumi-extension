import type { StateStorage } from 'zustand/middleware'

const DEBOUNCE_MS = 100
const BYTE_LIMIT = 8 * 1024 * 1024 // 8MB safety cap

const timers = new Map<string, number>()
const pending = new Map<string, string>()

async function flush(key: string) {
  const value = pending.get(key)
  if (value === undefined) return
  pending.delete(key)

  await chrome.storage.local.set({ [key]: value })

  // Best-effort storage cap guard on the specific key
  try {
    const bytes = await chrome.storage.local.getBytesInUse(key)
    if (bytes > BYTE_LIMIT) {
      const parsed = JSON.parse(value)
      const msgs = parsed?.state?.messages
      if (Array.isArray(msgs)) {
        const system = msgs.find((m: any) => m?.role === 'system')
        const rest = msgs.filter((m: any) => m?.role !== 'system')
        const trimmed = [...(system ? [system] : []), ...rest.slice(-50)]
        parsed.state.messages = trimmed
        const newValue = JSON.stringify(parsed)
        await chrome.storage.local.set({ [key]: newValue })
      }
    }
  } catch {
    // no-op: best-effort
  }
}

export const debouncedChromeStorage: StateStorage = {
  getItem: async (key) => {
    const res = await chrome.storage.local.get([key])
    const v = (res as any)?.[key]
    return typeof v === 'string' ? v : v == null ? null : JSON.stringify(v)
  },
  setItem: async (key, value) => {
    pending.set(key, value)
    const prev = timers.get(key)
    if (prev) window.clearTimeout(prev)
    const t = window.setTimeout(() => {
      flush(key).catch(() => void 0)
    }, DEBOUNCE_MS)
    timers.set(key, t)
  },
  removeItem: async (key) => {
    const prev = timers.get(key)
    if (prev) window.clearTimeout(prev)
    pending.delete(key)
    await chrome.storage.local.remove(key)
  },
}

/**
 * Immediate write for critical operations (bypasses debounce)
 * Use for auth tokens, settings that must persist immediately
 */
export async function setItemImmediate(key: string, value: string): Promise<void> {
  pending.set(key, value)
  const prev = timers.get(key)
  if (prev) window.clearTimeout(prev)
  timers.delete(key)
  await flush(key)
}
