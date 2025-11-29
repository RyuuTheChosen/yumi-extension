import React, { useState, useEffect } from 'react'
import type { VisionConfig } from '../../lib/types/visionConfig'
import { DEFAULT_VISION_CONFIG, mergeVisionConfig } from '../../lib/types/visionConfig'
import { Eye, EyeOff, Save } from 'lucide-react'
import { cn } from '../../lib/design/utils'

export function VisionSettings() {
  const [config, setConfig] = useState<VisionConfig>(DEFAULT_VISION_CONFIG)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    chrome.storage.local.get('vision-abilities-config').then((data) => {
      setConfig(mergeVisionConfig(data['vision-abilities-config']))
      setLoading(false)
    })
  }, [])

  const saveConfig = async () => {
    await chrome.storage.local.set({ 'vision-abilities-config': config })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (loading) {
    return (
      <div className="p-4 text-center text-white/50">
        Loading...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Eye className="w-4 h-4" />
          Vision Abilities
        </h2>
        <p className="text-xs text-white/50">
          Enable Yumi to see and react to what you're doing
        </p>
      </div>

      {/* Selection Spotter */}
      <div className="space-y-2 rounded-lg border border-white/15 p-4 bg-white/5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-white">
            Selection Spotter
          </span>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={config.selectionSpotter.enabled}
              onChange={(e) =>
                setConfig({
                  ...config,
                  selectionSpotter: { ...config.selectionSpotter, enabled: e.target.checked },
                })
              }
              className="sr-only peer"
              aria-label="Toggle selection spotter"
            />
            <div className="w-9 h-5 bg-white/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white/60 after:border-white/30 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-white/70 peer-checked:after:bg-mono-900"></div>
          </label>
        </div>
        <p className="text-xs text-white/50">
          Comments when you highlight text on web pages
        </p>

        {config.selectionSpotter.enabled && (
          <div className="mt-3 space-y-3 pt-3 border-t border-white/10">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-white/60">
                  Min selection length
                </label>
                <span className="text-xs font-mono text-white/50">{config.selectionSpotter.minSelectionLength} chars</span>
              </div>
              <input
                type="range"
                min="5"
                max="100"
                step="5"
                value={config.selectionSpotter.minSelectionLength}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    selectionSpotter: {
                      ...config.selectionSpotter,
                      minSelectionLength: parseInt(e.target.value),
                    },
                  })
                }
                className="w-full h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer accent-white"
                aria-label="Minimum selection length"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-white/60">
                  Response delay
                </label>
                <span className="text-xs font-mono text-white/50">{config.selectionSpotter.debounceMs}ms</span>
              </div>
              <input
                type="range"
                min="100"
                max="2000"
                step="100"
                value={config.selectionSpotter.debounceMs}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    selectionSpotter: {
                      ...config.selectionSpotter,
                      debounceMs: parseInt(e.target.value),
                    },
                  })
                }
                className="w-full h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer accent-white"
                aria-label="Response delay"
              />
            </div>

            <div className="flex items-center justify-between">
              <label className="text-xs text-white/60">
                Ignore input fields
              </label>
              <input
                type="checkbox"
                checked={config.selectionSpotter.ignoreInputFields}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    selectionSpotter: {
                      ...config.selectionSpotter,
                      ignoreInputFields: e.target.checked,
                    },
                  })
                }
                className="w-4 h-4 rounded border-white/30 bg-white/10 accent-white"
              />
            </div>
          </div>
        )}
      </div>

      {/* Scroll Companion - Coming Soon */}
      <div className="space-y-2 rounded-lg border border-white/10 p-4 bg-white/5 opacity-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white">
              Scroll Companion
            </span>
            <span className="text-[10px] px-1.5 py-0.5 bg-white/10 rounded text-white/50">
              Soon
            </span>
          </div>
          <EyeOff className="w-4 h-4 text-white/40" />
        </div>
        <p className="text-xs text-white/50">
          Comments while you scroll through articles
        </p>
      </div>

      {/* Image Understanding */}
      <div className="space-y-2 rounded-lg border border-white/15 p-4 bg-white/5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-white">
            Image Understanding
          </span>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={config.imageUnderstanding.enabled}
              onChange={(e) =>
                setConfig({
                  ...config,
                  imageUnderstanding: {
                    ...config.imageUnderstanding,
                    enabled: e.target.checked
                  },
                })
              }
              className="sr-only peer"
              aria-label="Toggle image understanding"
            />
            <div className="w-9 h-5 bg-white/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white/60 after:border-white/30 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-white/70 peer-checked:after:bg-mono-900"></div>
          </label>
        </div>

        <p className="text-xs text-white/50">
          <span className="text-white/70">Ctrl/Cmd + Click</span> any image to analyze
        </p>

        {config.imageUnderstanding.enabled && (
          <div className="mt-3 space-y-3 pt-3 border-t border-white/10">
            <p className="text-xs text-white/60">
              Requires vision-capable model (GPT-4o or DeepSeek)
            </p>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-white/60">
                  Max image size
                </label>
                <span className="text-xs font-mono text-white/50">{config.imageUnderstanding.maxImageSize}px</span>
              </div>
              <input
                type="range"
                min="256"
                max="1024"
                step="128"
                value={config.imageUnderstanding.maxImageSize}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    imageUnderstanding: {
                      ...config.imageUnderstanding,
                      maxImageSize: parseInt(e.target.value),
                    },
                  })
                }
                className="w-full h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer accent-white"
                aria-label="Max image size"
              />
              <p className="text-[11px] text-white/40 mt-1">
                Larger sizes cost more tokens. 512px recommended.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Save Button */}
      <button
        onClick={saveConfig}
        disabled={saved}
        className={cn(
          "w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
          saved ? "bg-status-online text-white" : "bg-white/90 text-mono-900 hover:bg-white"
        )}
        aria-label={saved ? 'Settings saved' : 'Save settings'}
      >
        <Save className="w-4 h-4" />
        {saved ? 'Saved' : 'Save Settings'}
      </button>

      <p className="text-[11px] text-white/40 text-center">
        Vision abilities use your configured API key. Responses appear in chat.
      </p>
    </div>
  )
}
