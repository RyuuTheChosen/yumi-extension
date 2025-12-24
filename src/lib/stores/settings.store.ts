import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { debouncedChromeStorage } from '../core/zustandChromeStorage'
import { createLogger } from '../core/debug'

const log = createLogger('Settings')

// Hub user info after Discord auth
interface HubUser {
  id: string
  discordId: string
  discordUsername: string
  isAdmin: boolean
}

// Hub quota info
interface HubQuota {
  used: number
  limit: number
  period: string
  resetsAt: string
}

interface SettingsState {
  model: string  // User's preferred model (Hub routes to appropriate provider)
  // AI Hub settings (required for all API calls)
  hubUrl: string
  hubAccessToken: string | null
  hubRefreshToken: string | null
  hubUser: HubUser | null
  hubQuota: HubQuota | null
  // Live2D avatar overlay settings
  enableLive2D: boolean
  live2DModelUrl: string
  live2DScale: number
  // Model positioning within canvas (internal model adjustments)
  modelOffsetX: number  // -2000 to 2000 pixels
  modelOffsetY: number  // -2000 to 2000 pixels
  modelScaleMultiplier: number  // 0.5 to 10.0x additional scale
  // Active companion (slug of installed/bundled companion)
  activeCompanionSlug: string
  // TTS (Text-to-Speech) settings - via Hub
  ttsEnabled: boolean
  ttsVolume: number  // 0-1 volume level
  ttsSpeed: number   // 0.5-2.0 playback speed
  // STT (Speech-to-Text) settings - via Hub
  sttEnabled: boolean
  // Proactive Memory Settings
  proactiveEnabled: boolean
  proactiveFollowUp: boolean
  proactiveContext: boolean
  proactiveRandom: boolean
  proactiveWelcomeBack: boolean
  proactiveCooldownMins: number
  proactiveMaxPerSession: number
  // Auto Search Settings
  autoSearchEnabled: boolean
  setModel: (m: string) => void
  // Hub actions
  setHubUrl: (url: string) => void
  setHubAuth: (accessToken: string, refreshToken: string | null, user: HubUser, quota: HubQuota) => void
  clearHubAuth: () => void
  refreshHubQuota: () => Promise<void>
  // Live2D actions
  setEnableLive2D: (enabled: boolean) => void
  setLive2DModelUrl: (url: string) => void
  setLive2DScale: (scale: number) => void
  setModelOffsetX: (offset: number) => void
  setModelOffsetY: (offset: number) => void
  setModelScaleMultiplier: (multiplier: number) => void
  resetModelPosition: () => void
  // Companion actions
  setActiveCompanionSlug: (slug: string) => void
  // TTS setters
  setTTSEnabled: (enabled: boolean) => void
  setTTSVolume: (volume: number) => void
  setTTSSpeed: (speed: number) => void
  // STT setters
  setSTTEnabled: (enabled: boolean) => void
  // Proactive setters
  setProactiveEnabled: (enabled: boolean) => void
  setProactiveFollowUp: (enabled: boolean) => void
  setProactiveContext: (enabled: boolean) => void
  setProactiveRandom: (enabled: boolean) => void
  setProactiveWelcomeBack: (enabled: boolean) => void
  setProactiveCooldownMins: (mins: number) => void
  setProactiveMaxPerSession: (max: number) => void
  // Auto Search setters
  setAutoSearchEnabled: (enabled: boolean) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      model: 'gpt-4o-mini',  // Default model (Hub routes to appropriate provider)
      enableLive2D: true, // Avatar enabled by default
      live2DModelUrl: '/companions/yumi/model/model.model3.json',
      live2DScale: 0.5, // Default to 50% scale for better fit
      modelOffsetX: 0, // No horizontal offset by default
      modelOffsetY: 0, // No vertical offset by default
      modelScaleMultiplier: 1.0, // No additional scaling by default
      activeCompanionSlug: 'yumi', // Default to bundled Yumi companion
      // Hub defaults (required for API access)
      hubUrl: 'https://historic-tessy-yumi-labs-d3fc2b1c.koyeb.app',
      hubAccessToken: null,
      hubRefreshToken: null,
      hubUser: null,
      hubQuota: null,
      // TTS defaults (ElevenLabs via Hub)
      ttsEnabled: true,
      ttsVolume: 1.0, // Full volume by default
      ttsSpeed: 1.0,  // Normal speed by default
      // STT defaults (ElevenLabs via Hub)
      sttEnabled: false, // Opt-in, requires microphone permission
      // Proactive Memory defaults
      proactiveEnabled: true,
      proactiveFollowUp: true,
      proactiveContext: true,
      proactiveRandom: true,
      proactiveWelcomeBack: true,
      proactiveCooldownMins: 10,
      proactiveMaxPerSession: 10,
      // Auto Search defaults
      autoSearchEnabled: true,
      setModel: (m) => set({ model: m }),
      setEnableLive2D: (enabled) => set({ enableLive2D: enabled }),
      setLive2DModelUrl: (url) => set({ live2DModelUrl: url }),
      setLive2DScale: (scale) => set({ live2DScale: Math.max(0.1, Math.min(5, scale)) }),
      setModelOffsetX: (offset) => set({ modelOffsetX: Math.max(-2000, Math.min(2000, offset)) }),
      setModelOffsetY: (offset) => set({ modelOffsetY: Math.max(-2000, Math.min(2000, offset)) }),
      setModelScaleMultiplier: (multiplier) => set({ modelScaleMultiplier: Math.max(0.5, Math.min(10, multiplier)) }),
      resetModelPosition: () => set({ modelOffsetX: 0, modelOffsetY: 0, modelScaleMultiplier: 1.0 }),
      // Companion actions
      setActiveCompanionSlug: (slug) => set({ activeCompanionSlug: slug }),
      // Hub actions
      setHubUrl: (url) => set({ hubUrl: url }),
      setHubAuth: (accessToken, refreshToken, user, quota) => {
        /** Store tokens securely via background script */
        chrome.runtime.sendMessage({
          type: 'SET_HUB_AUTH',
          payload: { accessToken, refreshToken }
        }).catch(() => {
          log.error('Failed to store tokens securely')
        })
        /** Also keep in memory for UI */
        set({
          hubAccessToken: accessToken,
          hubRefreshToken: refreshToken,
          hubUser: user,
          hubQuota: quota
        })
      },
      clearHubAuth: () => {
        /** Clear tokens from secure storage via background script */
        chrome.runtime.sendMessage({
          type: 'CLEAR_HUB_AUTH'
        }).catch(() => {
          log.error('Failed to clear tokens from secure storage')
        })
        set({
          hubAccessToken: null,
          hubRefreshToken: null,
          hubUser: null,
          hubQuota: null
        })
      },
      refreshHubQuota: async () => {
        const { hubUrl, hubAccessToken, hubUser } = get()
        if (!hubAccessToken) return
        try {
          const res = await fetch(`${hubUrl}/v1/quota`, {
            headers: { 'Authorization': `Bearer ${hubAccessToken}` }
          })
          if (!res.ok) {
            log.error('Failed to refresh quota')
            return
          }
          const data = await res.json()

          // Extract user info if present (syncs isAdmin status)
          const { user, ...quota } = data

          // Update quota
          set({ hubQuota: quota })

          // Sync user info if API returned it
          if (user && hubUser) {
            const updatedUser = {
              ...hubUser,
              isAdmin: user.isAdmin ?? hubUser.isAdmin ?? false
            }
            // Only update if isAdmin changed
            if (updatedUser.isAdmin !== hubUser.isAdmin) {
              log.log('Synced user info from API, isAdmin:', updatedUser.isAdmin)
              set({ hubUser: updatedUser })
            }
          }
        } catch (err) {
          log.error('Hub quota refresh failed:', err)
        }
      },
      // TTS setters
      setTTSEnabled: (enabled) => set({ ttsEnabled: enabled }),
      setTTSVolume: (volume) => set({ ttsVolume: Math.max(0, Math.min(1, volume)) }),
      setTTSSpeed: (speed) => set({ ttsSpeed: Math.max(0.5, Math.min(2.0, speed)) }),
      // STT setters
      setSTTEnabled: (enabled) => set({ sttEnabled: enabled }),
      // Proactive setters
      setProactiveEnabled: (enabled) => set({ proactiveEnabled: enabled }),
      setProactiveFollowUp: (enabled) => set({ proactiveFollowUp: enabled }),
      setProactiveContext: (enabled) => set({ proactiveContext: enabled }),
      setProactiveRandom: (enabled) => set({ proactiveRandom: enabled }),
      setProactiveWelcomeBack: (enabled) => set({ proactiveWelcomeBack: enabled }),
      setProactiveCooldownMins: (mins) => set({ proactiveCooldownMins: Math.max(5, Math.min(60, mins)) }),
      setProactiveMaxPerSession: (max) => set({ proactiveMaxPerSession: Math.max(1, Math.min(20, max)) }),
      // Auto Search setters
      setAutoSearchEnabled: (enabled) => set({ autoSearchEnabled: enabled }),
    }),
    {
      name: 'settings-store',
      storage: createJSONStorage(() => debouncedChromeStorage),
      partialize: (s) => ({
        model: s.model,
        enableLive2D: s.enableLive2D,
        live2DModelUrl: s.live2DModelUrl,
        live2DScale: s.live2DScale,
        modelOffsetX: s.modelOffsetX,
        modelOffsetY: s.modelOffsetY,
        modelScaleMultiplier: s.modelScaleMultiplier,
        activeCompanionSlug: s.activeCompanionSlug,
        /**
         * Hub fields - SECURITY: tokens are NOT persisted here
         * Access token: stored in chrome.storage.session (cleared on browser close)
         * Refresh token: encrypted and stored separately in chrome.storage.local
         */
        hubUrl: s.hubUrl,
        hubUser: s.hubUser,
        hubQuota: s.hubQuota,
        /** TTS fields */
        ttsEnabled: s.ttsEnabled,
        ttsVolume: s.ttsVolume,
        ttsSpeed: s.ttsSpeed,
        /** STT fields */
        sttEnabled: s.sttEnabled,
        /** Proactive fields */
        proactiveEnabled: s.proactiveEnabled,
        proactiveFollowUp: s.proactiveFollowUp,
        proactiveContext: s.proactiveContext,
        proactiveRandom: s.proactiveRandom,
        proactiveWelcomeBack: s.proactiveWelcomeBack,
        proactiveCooldownMins: s.proactiveCooldownMins,
        proactiveMaxPerSession: s.proactiveMaxPerSession,
        /** Auto Search fields */
        autoSearchEnabled: s.autoSearchEnabled,
      }),
      skipHydration: true, /** Manual rehydration for content script timing control */
      version: 22, /** Security: tokens moved to secure storage */
      migrate: (persisted: any, fromVersion: number) => {
        /** Handle older shapes by adding new defaults */
        const base = persisted || {}
        const state = { ...(base.state || {}) }
        if (fromVersion < 1) {
          // Introduced provider/model defaults historically
          if (!state.model) state.model = 'gpt-4o-mini'
        }
        if (fromVersion < 2) {
          // Introduced Live2D related fields
          if (typeof state.enableLive2D !== 'boolean') state.enableLive2D = false
          if (typeof state.live2DModelUrl !== 'string') state.live2DModelUrl = '/companions/yumi/model/model.model3.json'
          if (typeof state.live2DScale !== 'number') state.live2DScale = 0.5
          // Migration: enableLive2DOverlay was merged into enableLive2D
          if (typeof (state as any).enableLive2DOverlay === 'boolean') {
            state.enableLive2D = (state as any).enableLive2DOverlay
            delete (state as any).enableLive2DOverlay
          }
        }
        if (fromVersion < 3) {
          // Introduced model positioning fields
          if (typeof state.modelOffsetX !== 'number') state.modelOffsetX = 0
          if (typeof state.modelOffsetY !== 'number') state.modelOffsetY = 0
          if (typeof state.modelScaleMultiplier !== 'number') state.modelScaleMultiplier = 1.0
        }
        if (fromVersion < 7) {
          // Clean up old TTS format (had different field names)
          delete (state as any).ttsVoiceInstructions
          delete (state as any).ttsModel
        }
        if (fromVersion < 8) {
          // Introduced Hub settings
          if (typeof state.hubUrl !== 'string') state.hubUrl = 'https://historic-tessy-yumi-labs-d3fc2b1c.koyeb.app'
          if (!state.hubAccessToken) state.hubAccessToken = null
          if (!state.hubRefreshToken) state.hubRefreshToken = null
          if (!state.hubUser) state.hubUser = null
          // Introduced TTS settings with new format
          if (typeof state.ttsEnabled !== 'boolean') state.ttsEnabled = false
          if (typeof state.ttsProvider !== 'string') state.ttsProvider = 'openai'
          if (typeof state.ttsVoice !== 'string') state.ttsVoice = 'nova'
          if (typeof state.ttsSpeed !== 'number') state.ttsSpeed = 1.0
        }
        if (fromVersion < 9) {
          // Discord-based auth - reset old email-based auth
          if (!state.hubQuota) state.hubQuota = null
          // Clear old email-based user if present
          if (state.hubUser && 'email' in state.hubUser) {
            state.hubUser = null
            state.hubAccessToken = null
            state.hubRefreshToken = null
          }
          // Introduced ElevenLabs TTS provider
          if (!state.elevenlabsApiKey) state.elevenlabsApiKey = null
          if (typeof state.elevenlabsVoiceId !== 'string') state.elevenlabsVoiceId = 'EXAVITQu4vr4xnSDxMaL'
          if (typeof state.elevenlabsModelId !== 'string') state.elevenlabsModelId = 'eleven_turbo_v2_5'
        }
        if (fromVersion < 10) {
          // Hub-only mode - remove deprecated client-only API key fields
          delete state.apiKey
          delete state.openaiApiKey
          delete state.deepseekApiKey
          delete state.provider
          delete state.useHub  // No longer needed, Hub is always used
        }
        if (fromVersion < 11) {
          // Add isAdmin field to existing hubUser
          if (state.hubUser && typeof state.hubUser.isAdmin !== 'boolean') {
            state.hubUser.isAdmin = false
          }
        }
        if (fromVersion < 12) {
          // Migrate to new companion folder structure
          if (state.live2DModelUrl === '/models/yumi/akaituno.model3.json') {
            state.live2DModelUrl = '/companions/yumi/model/model.model3.json'
          }
        }
        if (fromVersion < 13) {
          // Add active companion slug (defaults to bundled Yumi)
          if (typeof state.activeCompanionSlug !== 'string') {
            state.activeCompanionSlug = 'yumi'
          }
        }
        if (fromVersion < 14) {
          // Merged TTS from avatar-expressions branch - ensure all TTS fields exist
          if (typeof state.ttsEnabled !== 'boolean') state.ttsEnabled = false
          if (typeof state.ttsVoice !== 'string') state.ttsVoice = 'MEJe6hPrI48Kt2lFuVe3'
        }
        if (fromVersion < 15) {
          // TTS now goes through Hub - remove old ElevenLabs API key fields
          delete state.elevenlabsApiKey
          delete state.elevenlabsVoiceId
          delete state.elevenlabsModelId
          delete state.ttsProvider
          delete state.ttsSpeed
          // Default to Yumi voice if using old Sarah default
          if (state.ttsVoice === 'EXAVITQu4vr4xnSDxMaL') {
            state.ttsVoice = 'MEJe6hPrI48Kt2lFuVe3' // Yumi voice
          }
        }
        if (fromVersion < 16) {
          // Fix users stuck with invalid "nova" voice from v8 migration
          if (state.ttsVoice === 'nova') {
            state.ttsVoice = 'MEJe6hPrI48Kt2lFuVe3' // Yumi voice
          }
        }
        if (fromVersion < 17) {
          // Voice now comes from companion - remove ttsVoice, add ttsVolume
          delete state.ttsVoice
          if (typeof state.ttsVolume !== 'number') state.ttsVolume = 1.0
        }
        if (fromVersion < 18) {
          // Add TTS speed control
          if (typeof state.ttsSpeed !== 'number') state.ttsSpeed = 1.0
        }
        if (fromVersion < 19) {
          // Add STT (Speech-to-Text) setting
          if (typeof state.sttEnabled !== 'boolean') state.sttEnabled = false
        }
        if (fromVersion < 20) {
          // Add Proactive Memory settings
          if (typeof state.proactiveEnabled !== 'boolean') state.proactiveEnabled = true
          if (typeof state.proactiveFollowUp !== 'boolean') state.proactiveFollowUp = true
          if (typeof state.proactiveContext !== 'boolean') state.proactiveContext = true
          if (typeof state.proactiveRandom !== 'boolean') state.proactiveRandom = true
          if (typeof state.proactiveWelcomeBack !== 'boolean') state.proactiveWelcomeBack = true
          if (typeof state.proactiveCooldownMins !== 'number') state.proactiveCooldownMins = 10
          if (typeof state.proactiveMaxPerSession !== 'number') state.proactiveMaxPerSession = 10
        }
        if (fromVersion < 21) {
          /** Add Auto Search setting */
          if (typeof state.autoSearchEnabled !== 'boolean') state.autoSearchEnabled = true
        }
        if (fromVersion < 22) {
          /**
           * SECURITY: Tokens moved to secure storage
           * Access token -> chrome.storage.session (cleared on browser close)
           * Refresh token -> AES-GCM encrypted in chrome.storage.local
           *
           * The actual migration of token values is handled by the background
           * script on startup (migrateTokensToSecureStorage in auth.ts)
           * Here we just remove the fields from the persisted state.
           */
          delete state.hubAccessToken
          delete state.hubRefreshToken
        }
        return { ...base, state }
      },
      onRehydrateStorage: () => {
        log.log('Hydration starts')
        return (state, error) => {
          if (error) {
            log.error('Hydration failed:', error)
          } else {
            log.log('Hydration finished successfully')
            if (state) {
              /** Validate and fix numeric bounds on rehydration */
              let needsFix = false
              const fixes: Record<string, { from: number; to: number }> = {}

              if (typeof state.live2DScale === 'number') {
                const clamped = Math.max(0.1, Math.min(5, state.live2DScale))
                if (clamped !== state.live2DScale) {
                  fixes.live2DScale = { from: state.live2DScale, to: clamped }
                  state.setLive2DScale(clamped)
                  needsFix = true
                }
              }

              if (typeof state.modelOffsetX === 'number') {
                const clamped = Math.max(-2000, Math.min(2000, state.modelOffsetX))
                if (clamped !== state.modelOffsetX) {
                  fixes.modelOffsetX = { from: state.modelOffsetX, to: clamped }
                  state.setModelOffsetX(clamped)
                  needsFix = true
                }
              }

              if (typeof state.modelOffsetY === 'number') {
                const clamped = Math.max(-2000, Math.min(2000, state.modelOffsetY))
                if (clamped !== state.modelOffsetY) {
                  fixes.modelOffsetY = { from: state.modelOffsetY, to: clamped }
                  state.setModelOffsetY(clamped)
                  needsFix = true
                }
              }

              if (typeof state.modelScaleMultiplier === 'number') {
                const clamped = Math.max(0.5, Math.min(10, state.modelScaleMultiplier))
                if (clamped !== state.modelScaleMultiplier) {
                  fixes.modelScaleMultiplier = { from: state.modelScaleMultiplier, to: clamped }
                  state.setModelScaleMultiplier(clamped)
                  needsFix = true
                }
              }

              if (needsFix) {
                log.warn('Fixed out-of-bounds settings on rehydration:', fixes)
              }

              const hasModel = typeof state.model === 'string'
              const hasLive2D = typeof state.enableLive2D === 'boolean'
              const hasHubUrl = typeof state.hubUrl === 'string'
              log.log('State validation:', { hasModel, hasLive2D, hasHubUrl })
            }
          }
        }
      },
    }
  )
)
