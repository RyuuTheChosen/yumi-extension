// Minimal polyfills for tests
// Ensure webcrypto is available under Node (Vitest environment)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g: any = globalThis as any
try {
  // Dynamically import node:crypto to avoid bundler issues
  // @ts-ignore
  const nodeCrypto = await import('node:crypto')
  if (!g.crypto) g.crypto = nodeCrypto.webcrypto
  if (!g.crypto.subtle) g.crypto.subtle = nodeCrypto.webcrypto.subtle
} catch {}

if (typeof g.crypto.randomUUID !== 'function') {
  let c = 0
  g.crypto.randomUUID = () => `00000000-0000-4000-8000-${(c++).toString().padStart(12, '0')}`
}

// Provide a minimal window shim for code that expects browser timers
if (!('window' in g)) {
  g.window = g
}
if (typeof g.window.setTimeout !== 'function') {
  g.window.setTimeout = g.setTimeout.bind(g)
}
if (typeof g.window.clearTimeout !== 'function') {
  g.window.clearTimeout = g.clearTimeout.bind(g)
}

// Provide a very small chrome.storage and runtime mock for tests
// Tests can further spy/override per-case.
if (!g.chrome) g.chrome = {} as any
if (!g.chrome.runtime) g.chrome.runtime = {} as any
if (typeof g.chrome.runtime.sendMessage !== 'function') {
  g.chrome.runtime.sendMessage = () => {}
}

const memory = new Map<string, string>()
if (!g.chrome.storage) g.chrome.storage = {} as any
if (!g.chrome.storage.local) g.chrome.storage.local = {} as any
if (typeof g.chrome.storage.local.get !== 'function') {
  g.chrome.storage.local.get = async (keys?: string[] | Record<string, unknown>) => {
    const result: Record<string, unknown> = {}
    if (Array.isArray(keys)) {
      for (const k of keys) result[k] = memory.has(k) ? memory.get(k) : undefined
    } else if (keys && typeof keys === 'object') {
      for (const k of Object.keys(keys)) result[k] = memory.has(k) ? memory.get(k) : (keys as any)[k]
    } else {
      for (const [k, v] of memory) result[k] = v
    }
    return result
  }
}
if (typeof g.chrome.storage.local.set !== 'function') {
  g.chrome.storage.local.set = async (items: Record<string, string>) => {
    for (const [k, v] of Object.entries(items)) memory.set(k, v as any)
  }
}
if (typeof g.chrome.storage.local.remove !== 'function') {
  g.chrome.storage.local.remove = async (key: string) => {
    memory.delete(key)
  }
}
if (typeof g.chrome.storage.local.getBytesInUse !== 'function') {
  g.chrome.storage.local.getBytesInUse = async (key?: string) => {
    if (!key) return 0
    const v = memory.get(key)
    return v ? new TextEncoder().encode(String(v)).length : 0
  }
}
