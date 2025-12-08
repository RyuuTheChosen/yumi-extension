import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { debouncedChromeStorage } from '../core/zustandChromeStorage'
import {
  Personality,
  createPersonality,
  updatePersonality,
  assembleSystemPrompt,
  DEFAULT_PERSONALITY,
} from '../personality'
import { createLogger } from '../core/debug'

const log = createLogger('Personality')

const MAX_PERSONALITIES = 12

interface PersonalityState {
  list: Personality[]
  activeId: string | null
  ensureDefault: () => void
  resetToDefault: () => void
  create: (data: { name: string; systemPrompt: string; avatar?: string; traits?: string[] }) => void
  update: (id: string, patch: Partial<Omit<Personality, 'id' | 'createdAt' | 'version'>>) => void
  remove: (id: string) => void
  setActive: (id: string) => void
  getActivePrompt: () => string
  exportAll: () => string
  importFromJSON: (json: string) => { imported: number; total: number }
  duplicate: (id: string) => void
}

export const usePersonalityStore = create<PersonalityState>()(
  persist(
    (set, get) => ({
      list: [],
      activeId: null,
      ensureDefault: () => {
        const s = get()
        if (s.list.length === 0) {
          const p = createPersonality({
            name: DEFAULT_PERSONALITY.name,
            systemPrompt: DEFAULT_PERSONALITY.systemPrompt,
            avatar: DEFAULT_PERSONALITY.avatar,
            traits: DEFAULT_PERSONALITY.traits,
          })
          set({ list: [p], activeId: p.id })
        } else if (!s.activeId) {
          set({ activeId: s.list[0]?.id ?? null })
        }
      },
      resetToDefault: () => {
        // Force-create a fresh default personality with latest config
        const p = createPersonality({
          name: DEFAULT_PERSONALITY.name,
          systemPrompt: DEFAULT_PERSONALITY.systemPrompt,
          avatar: DEFAULT_PERSONALITY.avatar,
          traits: DEFAULT_PERSONALITY.traits,
        })
        set({ list: [p], activeId: p.id })
      },
      create: (data) => {
        const s = get()
        const p = createPersonality(data)
        const list = [...s.list, p].slice(0, MAX_PERSONALITIES)
        set({ list, activeId: p.id })
      },
      update: (id, patch) => {
        const list = get().list.map((p) => (p.id === id ? updatePersonality(p, patch) : p))
        set({ list })
      },
      remove: (id) => {
        const list = get().list.filter((p) => p.id !== id)
        let activeId = get().activeId
        if (activeId === id) activeId = list[0]?.id ?? null
        set({ list, activeId })
      },
      setActive: (id) => {
        const exists = get().list.some((p) => p.id === id)
        if (!exists) return
        set({ activeId: id })
      },
      getActivePrompt: () => {
        const s = get()
        const p = s.list.find((x) => x.id === s.activeId) || s.list[0]
        if (!p) {
          // Fallback minimal default prompt
          return 'You are Yumi, a privacy-first web companion.'
        }
        return assembleSystemPrompt(p)
      },
      exportAll: () => {
        const data = get().list.map(({ name, avatar, traits, systemPrompt, version }) => ({
          name,
          avatar,
          traits,
          systemPrompt,
          version,
        }))
        return JSON.stringify({ personalities: data }, null, 2)
      },
      importFromJSON: (json: string) => {
        let payload: any
        try {
          payload = JSON.parse(json)
        } catch (e) {
          throw new Error('Invalid JSON')
        }
        const items: any[] = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.personalities)
          ? payload.personalities
          : []
        if (!items.length) return { imported: 0, total: get().list.length }

        // Import by creating new personalities to ensure schema & new ids
        const created = items.map((raw) =>
          createPersonality({
            name: String(raw?.name || 'Imported'),
            systemPrompt: String(
              raw?.systemPrompt || 'You are Yumi imported personality. Provide helpful, concise support.'
            ),
            avatar: typeof raw?.avatar === 'string' ? raw.avatar : '',
            traits: Array.isArray(raw?.traits) ? raw.traits.slice(0, 12) : [],
          })
        )
        const merged = [...get().list, ...created].slice(0, MAX_PERSONALITIES)
        set({ list: merged, activeId: merged[merged.length - 1]?.id ?? get().activeId })
        return { imported: created.length, total: merged.length }
      },
      duplicate: (id: string) => {
        const s = get()
        const src = s.list.find((p) => p.id === id)
        if (!src) return
        const names = s.list.map((x) => x.name)
        const copy = createPersonality({
          name: `${src.name} (copy)`,
          systemPrompt: src.systemPrompt,
          avatar: src.avatar,
          traits: src.traits,
        })
        const list = [...s.list, copy].slice(0, MAX_PERSONALITIES)
        set({ list, activeId: copy.id })
      },
    }),
    {
      name: 'personality-store',
      storage: createJSONStorage(() => debouncedChromeStorage),
      partialize: (s) => ({ list: s.list, activeId: s.activeId }),
      skipHydration: true, // Manual rehydration for content script timing control
      version: 2,
      migrate: (persistedState: any, version: number) => {
        // If upgrading from v1 to v2, force reset to new waifu personality
        if (version < 2) {
          const freshPersonality = createPersonality({
            name: DEFAULT_PERSONALITY.name,
            systemPrompt: DEFAULT_PERSONALITY.systemPrompt,
            avatar: DEFAULT_PERSONALITY.avatar,
            traits: DEFAULT_PERSONALITY.traits,
          })
          return {
            list: [freshPersonality],
            activeId: freshPersonality.id,
          }
        }
        return persistedState as any
      },
      onRehydrateStorage: (state) => {
        log.log('Hydration starts')
        return (state, error) => {
          if (error) {
            log.error('Hydration failed:', error)
            return
          }

          log.log('Hydration finished successfully')

          // Ensure safe defaults if storage is empty or corrupted
          if (!state) return
          if (!Array.isArray(state.list)) state.list = []
          if (typeof state.activeId !== 'string') state.activeId = null

          // If no personalities exist, create default
          if (state.list.length === 0) {
            const defaultPersonality = createPersonality({
              name: DEFAULT_PERSONALITY.name,
              systemPrompt: DEFAULT_PERSONALITY.systemPrompt,
              avatar: DEFAULT_PERSONALITY.avatar,
              traits: DEFAULT_PERSONALITY.traits,
            })
            state.list = [defaultPersonality]
            state.activeId = defaultPersonality.id
            log.log('Created default personality')
          }

          log.log('State validation:', {
            hasPersonalities: state.list.length > 0,
            activeId: state.activeId
          })
        }
      },
    }
  )
)

// Expose a helper for debugging/console access
if (typeof window !== 'undefined') {
  ;(window as any).resetYumiPersonality = () => {
    usePersonalityStore.getState().resetToDefault()
    log.log('✅ Yumi personality reset to latest default!')
  }
}
