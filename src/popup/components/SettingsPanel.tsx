import React, { useEffect, useState } from 'react'
import { Check, AlertCircle, Bot, Eye, Cloud, Download, ExternalLink, Loader2, Volume2, Brain } from 'lucide-react'
import { useSettingsStore } from '../../lib/stores/settings.store'
import { cn } from '../../lib/design/utils'
import { VisionSettings } from './VisionSettings'
import { MemoryBrowser } from './MemoryBrowser'
import { getInstalledCompanions, getCompanionFileUrl, type StoredCompanion } from '../../lib/companions/db'
import { createLogger } from '../../lib/core/debug'

const log = createLogger('SettingsPanel')

// Companion option for selector
interface CompanionOption {
  slug: string
  name: string
  isInstalled: boolean  // true = from IndexedDB, false = bundled
  previewUrl?: string   // Preview image URL
}

type TabType = 'hub' | 'avatar' | 'vision' | 'voice' | 'memory'

export function SettingsPanel() {
  const [activeTab, setActiveTab] = useState<TabType>('hub')
  // Companion selection
  const [companions, setCompanions] = useState<CompanionOption[]>([])
  const [loadingCompanions, setLoadingCompanions] = useState(false)
  const activeCompanionSlug = useSettingsStore(s => s.activeCompanionSlug)
  const setActiveCompanionSlug = useSettingsStore(s => s.setActiveCompanionSlug)
  // Live2D
  const enableLive2D = useSettingsStore(s => s.enableLive2D)
  const setEnableLive2D = useSettingsStore(s => s.setEnableLive2D)
  const live2DScale = useSettingsStore(s => s.live2DScale)
  const setLive2DScale = useSettingsStore(s => s.setLive2DScale)
  // Model positioning within canvas
  const modelOffsetX = useSettingsStore(s => s.modelOffsetX)
  const setModelOffsetX = useSettingsStore(s => s.setModelOffsetX)
  const modelOffsetY = useSettingsStore(s => s.modelOffsetY)
  const setModelOffsetY = useSettingsStore(s => s.setModelOffsetY)
  const modelScaleMultiplier = useSettingsStore(s => s.modelScaleMultiplier)
  const setModelScaleMultiplier = useSettingsStore(s => s.setModelScaleMultiplier)
  const resetModelPosition = useSettingsStore(s => s.resetModelPosition)

  // TTS settings (voice comes from companion)
  const ttsEnabled = useSettingsStore(s => s.ttsEnabled)
  const setTTSEnabled = useSettingsStore(s => s.setTTSEnabled)
  const ttsVolume = useSettingsStore(s => s.ttsVolume)
  const setTTSVolume = useSettingsStore(s => s.setTTSVolume)
  const ttsSpeed = useSettingsStore(s => s.ttsSpeed)
  const setTTSSpeed = useSettingsStore(s => s.setTTSSpeed)

  // STT settings (speech-to-text)
  const sttEnabled = useSettingsStore(s => s.sttEnabled)
  const setSTTEnabled = useSettingsStore(s => s.setSTTEnabled)

  // Proactive Memory settings
  const proactiveEnabled = useSettingsStore(s => s.proactiveEnabled)
  const setProactiveEnabled = useSettingsStore(s => s.setProactiveEnabled)
  const proactiveFollowUp = useSettingsStore(s => s.proactiveFollowUp)
  const setProactiveFollowUp = useSettingsStore(s => s.setProactiveFollowUp)
  const proactiveContext = useSettingsStore(s => s.proactiveContext)
  const setProactiveContext = useSettingsStore(s => s.setProactiveContext)
  const proactiveRandom = useSettingsStore(s => s.proactiveRandom)
  const setProactiveRandom = useSettingsStore(s => s.setProactiveRandom)
  const proactiveWelcomeBack = useSettingsStore(s => s.proactiveWelcomeBack)
  const setProactiveWelcomeBack = useSettingsStore(s => s.setProactiveWelcomeBack)
  const proactiveCooldownMins = useSettingsStore(s => s.proactiveCooldownMins)
  const setProactiveCooldownMins = useSettingsStore(s => s.setProactiveCooldownMins)
  const proactiveMaxPerSession = useSettingsStore(s => s.proactiveMaxPerSession)
  const setProactiveMaxPerSession = useSettingsStore(s => s.setProactiveMaxPerSession)

  // Hub settings (required for API access)
  const hubUrl = useSettingsStore((s) => s.hubUrl)
  const setHubUrl = useSettingsStore((s) => s.setHubUrl)
  const hubUser = useSettingsStore((s) => s.hubUser)
  const hubAccessToken = useSettingsStore((s) => s.hubAccessToken)
  const setHubAuth = useSettingsStore((s) => s.setHubAuth)
  const clearHubAuth = useSettingsStore((s) => s.clearHubAuth)


  // Hub quota
  const hubQuota = useSettingsStore((s) => s.hubQuota)
  const refreshHubQuota = useSettingsStore((s) => s.refreshHubQuota)

  // Hub invite code form state
  const [inviteCode, setInviteCode] = useState('')
  const [hubLoading, setHubLoading] = useState(false)
  const [hubError, setHubError] = useState<string | null>(null)
  const [hubSuccess, setHubSuccess] = useState<string | null>(null)

  async function handleActivateCode() {
    if (!inviteCode.trim()) return
    setHubLoading(true)
    setHubError(null)
    setHubSuccess(null)
    try {
      const res = await fetch(`${hubUrl}/auth/discord`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: inviteCode.trim().toUpperCase() })
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Activation failed')
      }
      setHubAuth(data.accessToken, data.refreshToken || null, data.user, data.quota)
      setInviteCode('')
      setHubSuccess('Account activated!')
    } catch (err: any) {
      setHubError(err?.message || 'Connection failed')
    } finally {
      setHubLoading(false)
    }
  }

  // Refresh quota on Hub tab open
  useEffect(() => {
    if (activeTab === 'hub' && hubAccessToken) {
      refreshHubQuota()
    }
  }, [activeTab, hubAccessToken, refreshHubQuota])

  // Load companions on Avatar tab open
  useEffect(() => {
    if (activeTab === 'avatar') {
      loadCompanionOptions()
    }
  }, [activeTab])

  // Load available companions (bundled + installed)
  async function loadCompanionOptions() {
    setLoadingCompanions(true)
    try {
      // Start with bundled Yumi
      const bundledPreviewUrl = chrome.runtime.getURL('companions/yumi/preview.png')
      const options: CompanionOption[] = [
        { slug: 'yumi', name: 'Yumi (Bundled)', isInstalled: false, previewUrl: bundledPreviewUrl }
      ]

      // Add installed companions from IndexedDB
      const installed = await getInstalledCompanions()
      for (const c of installed) {
        // Get preview URL for installed companion
        const previewUrl = await getCompanionFileUrl(c.slug, c.manifest.preview) || undefined

        // Skip if it's Yumi (already have bundled)
        if (c.slug === 'yumi') {
          // Replace bundled with installed version
          options[0] = { slug: 'yumi', name: 'Yumi (Installed)', isInstalled: true, previewUrl }
        } else {
          options.push({
            slug: c.slug,
            name: c.manifest.name,
            isInstalled: true,
            previewUrl
          })
        }
      }

      setCompanions(options)
    } catch (err) {
      log.error('Failed to load companions:', err)
    } finally {
      setLoadingCompanions(false)
    }
  }

  function handleHubLogout() {
    clearHubAuth()
    setHubSuccess(null)
    setHubError(null)
  }

  // Welcome gate - show login screen when not connected
  if (!hubAccessToken) {
    return (
      <div className="flex flex-col h-full" style={{ background: 'rgba(20, 20, 20, 0.95)' }}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white">Yumi Settings</h2>
          <p className="text-xs text-white/50">
            Configure your AI companion
          </p>
        </div>

        {/* Welcome Screen */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 space-y-6">
          <div className="text-center space-y-2">
            <h3 className="text-xl font-semibold text-white">
              Welcome to Yumi!
            </h3>
            <p className="text-sm text-white/60 max-w-xs">
              Connect your account to start chatting with your AI companion.
            </p>
          </div>

          {/* Invite Code Form */}
          <div className="w-full max-w-xs space-y-3">
            <input
              type="text"
              placeholder="YUMI-XXXX"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleActivateCode()}
              className={cn(
                "w-full px-4 py-3 text-sm rounded-lg font-mono text-center tracking-wider",
                "border border-white/20 bg-white/10",
                "text-white placeholder:text-white/40",
                "focus:outline-none focus:bg-white/15 focus:border-white/40"
              )}
              maxLength={12}
            />
            <button
              onClick={handleActivateCode}
              disabled={hubLoading || !inviteCode.trim()}
              className={cn(
                "w-full px-4 py-3 text-sm rounded-lg font-medium transition-colors",
                "bg-white/90 text-mono-900 hover:bg-white",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {hubLoading ? 'Activating...' : 'Activate'}
            </button>

            {hubError && (
              <div className="flex items-center justify-center gap-1.5 text-xs text-error">
                <AlertCircle size={12} />
                <span>{hubError}</span>
              </div>
            )}
            {hubSuccess && (
              <div className="flex items-center justify-center gap-1.5 text-xs text-status-online">
                <Check size={12} />
                <span>{hubSuccess}</span>
              </div>
            )}
          </div>

          {/* Discord Link */}
          <div className="text-center space-y-2">
            <p className="text-xs text-white/50">
              Don't have a code?
            </p>
            <a
              href="https://discord.gg/QPmrJS8baz"
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg font-medium transition-colors",
                "border border-white/20 hover:bg-white/10",
                "text-white/80"
              )}
            >
              Join Discord
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'rgba(20, 20, 20, 0.95)' }}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10">
        <h2 className="text-lg font-semibold text-white">Yumi Settings</h2>
        <p className="text-xs text-white/50">
          Configure your AI companion
        </p>
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto border-b border-white/10 scrollbar-hide">
        <button
          onClick={() => setActiveTab('hub')}
          className={cn(
            "flex items-center gap-1 px-3 py-2.5 text-xs font-medium transition-colors relative flex-shrink-0",
            "focus:outline-none",
            activeTab === 'hub'
              ? "text-white"
              : "text-white/50 hover:text-white/80"
          )}
          role="tab"
          aria-selected={activeTab === 'hub'}
          aria-controls="hub-panel"
        >
          <Cloud size={14} />
          Hub
          {activeTab === 'hub' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('avatar')}
          className={cn(
            "flex items-center gap-1 px-3 py-2.5 text-xs font-medium transition-colors relative flex-shrink-0",
            "focus:outline-none",
            activeTab === 'avatar'
              ? "text-white"
              : "text-white/50 hover:text-white/80"
          )}
          role="tab"
          aria-selected={activeTab === 'avatar'}
          aria-controls="avatar-panel"
        >
          <Bot size={14} />
          Avatar
          {activeTab === 'avatar' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('vision')}
          className={cn(
            "flex items-center gap-1 px-3 py-2.5 text-xs font-medium transition-colors relative flex-shrink-0",
            "focus:outline-none",
            activeTab === 'vision'
              ? "text-white"
              : "text-white/50 hover:text-white/80"
          )}
          role="tab"
          aria-selected={activeTab === 'vision'}
          aria-controls="vision-panel"
        >
          <Eye size={14} />
          Vision
          {activeTab === 'vision' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('voice')}
          className={cn(
            "flex items-center gap-1 px-3 py-2.5 text-xs font-medium transition-colors relative flex-shrink-0",
            "focus:outline-none",
            activeTab === 'voice'
              ? "text-white"
              : "text-white/50 hover:text-white/80"
          )}
          role="tab"
          aria-selected={activeTab === 'voice'}
          aria-controls="voice-panel"
        >
          <Volume2 size={14} />
          Voice
          {activeTab === 'voice' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('memory')}
          className={cn(
            "flex items-center gap-1 px-3 py-2.5 text-xs font-medium transition-colors relative flex-shrink-0",
            "focus:outline-none",
            activeTab === 'memory'
              ? "text-white"
              : "text-white/50 hover:text-white/80"
          )}
          role="tab"
          aria-selected={activeTab === 'memory'}
          aria-controls="memory-panel"
        >
          <Brain size={14} />
          Memory
          {activeTab === 'memory' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Avatar Settings Tab */}
        {activeTab === 'avatar' && (
          <>
        {/* Live2D Avatar Overlay */}
        <div className="flex flex-col gap-3 p-3 rounded-lg border border-white/15 bg-white/5">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <label className="text-sm font-medium text-white">
                Live2D Avatar Overlay
              </label>
              <p className="text-xs text-white/50 mt-0.5">
                Show avatar on webpages
              </p>
            </div>
            <button
              onClick={() => setEnableLive2D(!enableLive2D)}
              onMouseEnter={(e) => {
                if (enableLive2D) {
                  e.currentTarget.textContent = 'Unsummon'
                }
              }}
              onMouseLeave={(e) => {
                if (enableLive2D) {
                  e.currentTarget.textContent = 'Summoned'
                }
              }}
              className={cn(
                "px-4 py-2 text-xs font-bold rounded-lg transition-all duration-200",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
                enableLive2D
                  ? "bg-white/90 text-mono-900 hover:bg-white shadow-md hover:shadow-lg hover:scale-105 active:scale-95"
                  : "bg-white/15 text-white/70 hover:bg-white/25 hover:scale-102 active:scale-98"
              )}
            >
              {enableLive2D ? 'Summoned' : 'Summon'}
            </button>
          </div>
          {enableLive2D && (
            <div className="space-y-3 pt-2 border-t border-white/10">
              {/* Companion Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/70">Active Companion</label>
                <div className="flex items-center gap-3">
                  {/* Preview Image */}
                  {(() => {
                    const activeCompanion = companions.find(c => c.slug === activeCompanionSlug)
                    const previewUrl = activeCompanion?.previewUrl
                    return previewUrl ? (
                      <div className="w-10 h-10 rounded-lg overflow-hidden border border-white/20 bg-white/5 flex-shrink-0">
                        <img
                          src={previewUrl}
                          alt={activeCompanion?.name || 'Companion'}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="w-10 h-10 rounded-lg border border-white/20 bg-white/5 flex-shrink-0 flex items-center justify-center">
                        <Bot size={16} className="text-white/30" />
                      </div>
                    )
                  })()}
                  {/* Dropdown */}
                  <div className="relative flex-1">
                    <select
                      value={activeCompanionSlug}
                      onChange={(e) => setActiveCompanionSlug(e.target.value)}
                      disabled={loadingCompanions}
                      className={cn(
                        "w-full px-3 py-2 text-sm rounded-lg",
                        "border border-white/20 bg-white/10",
                        "text-white",
                        "focus:outline-none focus:bg-white/15 focus:border-white/40",
                        "disabled:opacity-50",
                        loadingCompanions && "pr-8"
                      )}
                    >
                      {loadingCompanions ? (
                        <option className="bg-mono-900 text-white">Loading...</option>
                      ) : (
                        companions.map((c) => (
                          <option key={c.slug} value={c.slug} className="bg-mono-900 text-white">
                            {c.name}
                          </option>
                        ))
                      )}
                    </select>
                    {loadingCompanions && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2">
                        <Loader2 size={14} className="animate-spin text-white/50" />
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-xs text-white/50">
                  {loadingCompanions
                    ? 'Loading companions...'
                    : companions.find(c => c.slug === activeCompanionSlug)?.isInstalled
                      ? 'Using installed version from marketplace'
                      : 'Using bundled companion'}
                </p>
              </div>

              {/* Get More Companions Link */}
              <button
                onClick={() => window.open('https://yumi-pals.com/companions', '_blank')}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 text-xs rounded-lg transition-colors w-full",
                  "border border-white/20 hover:bg-white/10 text-white/70 hover:text-white"
                )}
              >
                <Download size={14} />
                Get More Companions
                <ExternalLink size={12} className="ml-auto opacity-50" />
              </button>

              {/* Container Scale */}
              <div className="flex items-center gap-2 pt-1">
                <label className="text-xs text-white/60 w-24">Container Scale</label>
                <input
                  type="range"
                  min={0.3}
                  max={1.5}
                  step={0.05}
                  value={live2DScale}
                  onChange={(e) => setLive2DScale(parseFloat(e.target.value))}
                  className="flex-1 accent-white"
                />
                <span className="text-xs font-mono text-white/70 w-12 text-right">{live2DScale.toFixed(2)}x</span>
              </div>
            </div>
          )}
        </div>

        {/* Model Positioning Controls */}
        {enableLive2D && (
          <div className="flex flex-col gap-3 p-3 rounded-lg border border-white/15 bg-white/5">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <label className="text-sm font-medium text-white">
                  Model Position & Scale
                </label>
                <p className="text-xs text-white/50 mt-0.5">
                  Adjust model within canvas
                </p>
              </div>
              <button
                onClick={resetModelPosition}
                className={cn(
                  "px-2 py-1 text-xs rounded transition-colors text-white/70",
                  "border border-white/20 hover:bg-white/10"
                )}
              >
                Reset
              </button>
            </div>

            <div className="space-y-3 pt-2 border-t border-white/10">
              {/* Model Scale Multiplier */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-white/70">
                    Model Zoom
                  </label>
                  <span className="text-xs font-mono text-white/50">
                    {modelScaleMultiplier.toFixed(2)}x
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setModelScaleMultiplier(Math.max(0.5, modelScaleMultiplier - 0.1))}
                    className={cn(
                      "w-8 h-8 rounded flex items-center justify-center text-white/70",
                      "border border-white/20 hover:bg-white/10",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                    disabled={modelScaleMultiplier <= 0.5}
                  >
                    −
                  </button>
                  <input
                    type="range"
                    min={0.5}
                    max={10.0}
                    step={0.05}
                    value={modelScaleMultiplier}
                    onChange={(e) => setModelScaleMultiplier(parseFloat(e.target.value))}
                    className="flex-1 accent-white"
                  />
                  <button
                    onClick={() => setModelScaleMultiplier(Math.min(10.0, modelScaleMultiplier + 0.1))}
                    className={cn(
                      "w-8 h-8 rounded flex items-center justify-center text-white/70",
                      "border border-white/20 hover:bg-white/10",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                    disabled={modelScaleMultiplier >= 10.0}
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Horizontal Position */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-white/70">
                    Horizontal Position
                  </label>
                  <span className="text-xs font-mono text-white/50">
                    {modelOffsetX > 0 ? '+' : ''}{modelOffsetX}px
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setModelOffsetX(Math.max(-1000, modelOffsetX - 10))}
                    className={cn(
                      "w-8 h-8 rounded flex items-center justify-center text-white/70",
                      "border border-white/20 hover:bg-white/10",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                    disabled={modelOffsetX <= -1000}
                    title="Move left"
                  >
                    ←
                  </button>
                  <input
                    type="range"
                    min={-1000}
                    max={1000}
                    step={10}
                    value={modelOffsetX}
                    onChange={(e) => setModelOffsetX(parseInt(e.target.value))}
                    className="flex-1 accent-white"
                  />
                  <button
                    onClick={() => setModelOffsetX(Math.min(1000, modelOffsetX + 10))}
                    className={cn(
                      "w-8 h-8 rounded flex items-center justify-center text-white/70",
                      "border border-white/20 hover:bg-white/10",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                    disabled={modelOffsetX >= 1000}
                    title="Move right"
                  >
                    →
                  </button>
                </div>
              </div>

              {/* Vertical Position */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-white/70">
                    Vertical Position
                  </label>
                  <span className="text-xs font-mono text-white/50">
                    {modelOffsetY > 0 ? '+' : ''}{modelOffsetY}px
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setModelOffsetY(Math.max(-1000, modelOffsetY - 10))}
                    className={cn(
                      "w-8 h-8 rounded flex items-center justify-center text-white/70",
                      "border border-white/20 hover:bg-white/10",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                    disabled={modelOffsetY <= -1000}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <input
                    type="range"
                    min={-1000}
                    max={1000}
                    step={10}
                    value={modelOffsetY}
                    onChange={(e) => setModelOffsetY(parseInt(e.target.value))}
                    className="flex-1 accent-white"
                  />
                  <button
                    onClick={() => setModelOffsetY(Math.min(1000, modelOffsetY + 10))}
                    className={cn(
                      "w-8 h-8 rounded flex items-center justify-center text-white/70",
                      "border border-white/20 hover:bg-white/10",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                    disabled={modelOffsetY >= 1000}
                    title="Move down"
                  >
                    ↓
                  </button>
                </div>
              </div>

              <p className="text-xs text-white/50 leading-relaxed pt-1">
                Fine-tune how the model appears within its container. Changes apply immediately to the overlay.
              </p>
            </div>
          </div>
        )}
          </>
        )}

        {/* Vision Settings Tab */}
        {activeTab === 'vision' && (
          <VisionSettings />
        )}

        {/* Voice Settings Tab */}
        {activeTab === 'voice' && (
          <>
            {/* TTS Enable Toggle */}
            <div className="flex flex-col gap-3 p-3 rounded-lg border border-white/15 bg-white/5">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <label className="text-sm font-medium text-white">
                    Text-to-Speech
                  </label>
                  <p className="text-xs text-white/50 mt-0.5">
                    Yumi speaks responses aloud
                  </p>
                </div>
                <button
                  onClick={() => setTTSEnabled(!ttsEnabled)}
                  className={cn(
                    "px-4 py-2 text-xs font-bold rounded-lg transition-all duration-200",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
                    ttsEnabled
                      ? "bg-white/90 text-mono-900 hover:bg-white shadow-md"
                      : "bg-white/15 text-white/70 hover:bg-white/25"
                  )}
                >
                  {ttsEnabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            </div>

            {/* Volume Control */}
            {ttsEnabled && (
              <div className="flex flex-col gap-3 p-3 rounded-lg border border-white/15 bg-white/5">
                <div>
                  <label className="text-sm font-medium text-white">
                    Volume
                  </label>
                  <p className="text-xs text-white/50 mt-0.5">
                    Adjust voice playback volume
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={ttsVolume}
                    onChange={(e) => setTTSVolume(parseFloat(e.target.value))}
                    className="flex-1 accent-white"
                  />
                  <span className="text-xs font-mono text-white/70 w-12 text-right">
                    {Math.round(ttsVolume * 100)}%
                  </span>
                </div>
              </div>
            )}

            {/* Speed Control */}
            {ttsEnabled && (
              <div className="flex flex-col gap-3 p-3 rounded-lg border border-white/15 bg-white/5">
                <div>
                  <label className="text-sm font-medium text-white">
                    Speed
                  </label>
                  <p className="text-xs text-white/50 mt-0.5">
                    Adjust voice playback speed
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0.5}
                    max={2.0}
                    step={0.1}
                    value={ttsSpeed}
                    onChange={(e) => setTTSSpeed(parseFloat(e.target.value))}
                    className="flex-1 accent-white"
                  />
                  <span className="text-xs font-mono text-white/70 w-12 text-right">
                    {ttsSpeed.toFixed(1)}x
                  </span>
                </div>
                <p className="text-xs text-white/40">
                  Voice synthesis powered by ElevenLabs via Hub
                </p>
              </div>
            )}

            {/* STT Enable Toggle */}
            <div className="flex flex-col gap-3 p-3 rounded-lg border border-white/15 bg-white/5">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <label className="text-sm font-medium text-white">
                    Speech-to-Text
                  </label>
                  <p className="text-xs text-white/50 mt-0.5">
                    Hold mic button to record voice
                  </p>
                </div>
                <button
                  onClick={() => setSTTEnabled(!sttEnabled)}
                  className={cn(
                    "px-4 py-2 text-xs font-bold rounded-lg transition-all duration-200",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
                    sttEnabled
                      ? "bg-white/90 text-mono-900 hover:bg-white shadow-md"
                      : "bg-white/15 text-white/70 hover:bg-white/25"
                  )}
                >
                  {sttEnabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
              {sttEnabled && (
                <p className="text-xs text-white/40">
                  Requires microphone permission. Powered by ElevenLabs via Hub.
                </p>
              )}
            </div>
          </>
        )}

        {activeTab === 'memory' && (
          <>
            {/* Proactive Companion Section */}
            <div className="flex flex-col gap-3 p-3 rounded-lg border border-white/15 bg-white/5">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <label className="text-sm font-medium text-white">
                    Proactive Companion
                  </label>
                  <p className="text-xs text-white/50 mt-0.5">
                    Let Yumi initiate conversations
                  </p>
                </div>
                <button
                  onClick={() => setProactiveEnabled(!proactiveEnabled)}
                  className={cn(
                    "px-4 py-2 text-xs font-bold rounded-lg transition-all duration-200",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
                    proactiveEnabled
                      ? "bg-white/90 text-mono-900 hover:bg-white shadow-md"
                      : "bg-white/15 text-white/70 hover:bg-white/25"
                  )}
                >
                  {proactiveEnabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>

              {proactiveEnabled && (
                <div className="space-y-3 pt-3 border-t border-white/10">
                  {/* Feature Toggles */}
                  <div className="space-y-2 pl-2 border-l-2 border-white/10">
                    <label
                      className="flex items-center gap-2 cursor-pointer group"
                      onClick={() => setProactiveWelcomeBack(!proactiveWelcomeBack)}
                    >
                      <div className={cn(
                        "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                        proactiveWelcomeBack
                          ? "bg-white/90 border-white/90"
                          : "border-white/30 group-hover:border-white/50"
                      )}>
                        {proactiveWelcomeBack && <Check size={12} className="text-mono-900" />}
                      </div>
                      <span className="text-xs text-white/70">Welcome back greetings</span>
                    </label>

                    <label
                      className="flex items-center gap-2 cursor-pointer group"
                      onClick={() => setProactiveFollowUp(!proactiveFollowUp)}
                    >
                      <div className={cn(
                        "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                        proactiveFollowUp
                          ? "bg-white/90 border-white/90"
                          : "border-white/30 group-hover:border-white/50"
                      )}>
                        {proactiveFollowUp && <Check size={12} className="text-mono-900" />}
                      </div>
                      <span className="text-xs text-white/70">Follow-up questions</span>
                    </label>

                    <label
                      className="flex items-center gap-2 cursor-pointer group"
                      onClick={() => setProactiveContext(!proactiveContext)}
                    >
                      <div className={cn(
                        "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                        proactiveContext
                          ? "bg-white/90 border-white/90"
                          : "border-white/30 group-hover:border-white/50"
                      )}>
                        {proactiveContext && <Check size={12} className="text-mono-900" />}
                      </div>
                      <span className="text-xs text-white/70">Context connections</span>
                    </label>

                    <label
                      className="flex items-center gap-2 cursor-pointer group"
                      onClick={() => setProactiveRandom(!proactiveRandom)}
                    >
                      <div className={cn(
                        "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                        proactiveRandom
                          ? "bg-white/90 border-white/90"
                          : "border-white/30 group-hover:border-white/50"
                      )}>
                        {proactiveRandom && <Check size={12} className="text-mono-900" />}
                      </div>
                      <span className="text-xs text-white/70">Random recalls</span>
                    </label>
                  </div>

                  {/* Cooldown Slider */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-white/70">Cooldown</label>
                      <span className="text-xs font-mono text-white/50">{proactiveCooldownMins} min</span>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={60}
                      step={5}
                      value={proactiveCooldownMins}
                      onChange={(e) => setProactiveCooldownMins(parseInt(e.target.value))}
                      className="w-full accent-white"
                    />
                  </div>

                  {/* Session Limit Slider */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-white/70">Max per session</label>
                      <span className="text-xs font-mono text-white/50">{proactiveMaxPerSession}</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={20}
                      step={1}
                      value={proactiveMaxPerSession}
                      onChange={(e) => setProactiveMaxPerSession(parseInt(e.target.value))}
                      className="w-full accent-white"
                    />
                  </div>

                  <p className="text-xs text-white/40 pt-1">
                    Yumi will use her memories to ask follow-ups, make connections, and naturally bring up old topics.
                  </p>
                </div>
              )}
            </div>

            {/* Memory Browser */}
            <MemoryBrowser />
          </>
        )}

        {/* Hub Settings Tab */}
        {activeTab === 'hub' && (
          <>
            {/* Connected Status / Invite Code Form */}
            <div className="p-3 rounded-lg border border-white/15 bg-white/5">
              {hubUser && hubAccessToken ? (
                // Connected state
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">
                        {hubUser.discordUsername}
                      </p>
                      <p className="text-xs text-white/50">
                        {hubUser.isAdmin ? 'Admin' : 'Beta Tester'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "w-2 h-2 rounded-full",
                        hubUser.isAdmin ? "bg-amber-400" : "bg-status-online"
                      )}></span>
                      <span className={cn(
                        "text-xs font-medium",
                        hubUser.isAdmin ? "text-amber-400" : "text-status-online"
                      )}>
                        {hubUser.isAdmin ? 'Admin' : 'Active'}
                      </span>
                    </div>
                  </div>

                  {/* Quota Display */}
                  {hubUser.isAdmin ? (
                    // Admin: Unlimited access
                    <div className="p-2 bg-amber-500/10 rounded-lg border border-amber-500/30">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-amber-400">
                          Unlimited Access
                        </span>
                        <span className="text-xs text-amber-400/70">
                          No quota limits
                        </span>
                      </div>
                    </div>
                  ) : hubQuota ? (
                    // Regular user: Show quota progress
                    <div className="p-2 bg-white/5 rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-white/60">
                          Monthly Quota
                        </span>
                        <span className="text-xs text-white/50">
                          {hubQuota.used} / {hubQuota.limit}
                        </span>
                      </div>
                      <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className="h-full transition-all duration-300"
                          style={{
                            width: `${Math.min((hubQuota.used / hubQuota.limit) * 100, 100)}%`,
                            background: hubQuota.used >= hubQuota.limit ? '#ef4444' : 'rgba(255, 255, 255, 0.7)'
                          }}
                        />
                      </div>
                      <p className="text-xs text-white/40 mt-1">
                        Resets {new Date(hubQuota.resetsAt).toLocaleDateString()}
                      </p>
                    </div>
                  ) : null}

                  <button
                    onClick={handleHubLogout}
                    className={cn(
                      "w-full px-4 py-2 text-sm rounded-lg font-medium transition-colors text-white/70",
                      "border border-white/20 hover:bg-white/10"
                    )}
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                // Invite code form
                <div className="space-y-3">
                  <p className="text-sm font-medium text-white">
                    Enter Invite Code
                  </p>
                  <p className="text-xs text-white/50">
                    Get your code from the Yumi Discord with /getcode
                  </p>
                  <input
                    type="text"
                    placeholder="YUMI-XXXX"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === 'Enter' && handleActivateCode()}
                    className={cn(
                      "w-full px-3 py-2 text-sm rounded-lg font-mono text-center tracking-wider",
                      "border border-white/20 bg-white/10",
                      "text-white placeholder:text-white/40",
                      "focus:outline-none focus:bg-white/15 focus:border-white/40"
                    )}
                    maxLength={12}
                  />
                  <button
                    onClick={handleActivateCode}
                    disabled={hubLoading || !inviteCode.trim()}
                    className={cn(
                      "w-full px-4 py-2 text-sm rounded-lg font-medium transition-colors",
                      "bg-white/90 text-mono-900 hover:bg-white",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                  >
                    {hubLoading ? 'Activating...' : 'Activate'}
                  </button>

                  {hubError && (
                    <div className="flex items-center gap-1.5 text-xs text-error">
                      <AlertCircle size={12} />
                      <span>{hubError}</span>
                    </div>
                  )}
                  {hubSuccess && (
                    <div className="flex items-center gap-1.5 text-xs text-status-online">
                      <Check size={12} />
                      <span>{hubSuccess}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Hub Info */}
            <div className="p-3 bg-white/5 rounded-lg border border-white/15">
              <p className="text-xs text-white/60 leading-relaxed">
                Join the Yumi Discord to get your invite code. Beta testers get 100 free AI requests per month with access to multiple providers.
              </p>
            </div>

          </>
        )}
      </div>
    </div>
  )
}
