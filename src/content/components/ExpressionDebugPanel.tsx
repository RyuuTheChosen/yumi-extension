/**
 * ExpressionDebugPanel - Visual parameter tuning for Live2D expressions
 *
 * Allows real-time adjustment of expression parameters with sliders,
 * and saving/loading named presets.
 */

import React, { useState, useEffect, useCallback } from 'react'

interface ParameterConfig {
  id: string
  label: string
  min: number
  max: number
  step: number
  defaultValue: number
}

interface ExpressionPreset {
  name: string
  values: Record<string, number>
  createdAt: number
}

// Available expression parameters from the Yumi model
// Note: BrowAngle params exist but may not be visually wired in this model
const PARAMETERS: ParameterConfig[] = [
  { id: 'ParamMouthForm', label: 'Mouth Shape', min: -1, max: 1, step: 0.1, defaultValue: 0 },
  { id: 'ParamMouthOpenY', label: 'Mouth Open', min: 0, max: 1, step: 0.1, defaultValue: 0 },
  { id: 'ParamEyeLOpen', label: 'Left Eye Open', min: 0, max: 1.3, step: 0.1, defaultValue: 1 },
  { id: 'ParamEyeROpen', label: 'Right Eye Open', min: 0, max: 1.3, step: 0.1, defaultValue: 1 },
  { id: 'ParamEyeLSmile', label: 'Left Eye Smile', min: 0, max: 1, step: 0.1, defaultValue: 0 },
  { id: 'ParamEyeRSmile', label: 'Right Eye Smile', min: 0, max: 1, step: 0.1, defaultValue: 0 },
  { id: 'ParamBrowLY', label: 'Left Brow Y', min: -1, max: 1, step: 0.1, defaultValue: 0 },
  { id: 'ParamBrowRY', label: 'Right Brow Y', min: -1, max: 1, step: 0.1, defaultValue: 0 },
  { id: 'ParamBrowLForm', label: 'Left Brow Form', min: -1, max: 1, step: 0.1, defaultValue: 0 },
  { id: 'ParamBrowRForm', label: 'Right Brow Form', min: -1, max: 1, step: 0.1, defaultValue: 0 },
  { id: 'ParamBrowLAngle', label: 'L Brow Angle*', min: -1, max: 1, step: 0.1, defaultValue: 0 },
  { id: 'ParamBrowRAngle', label: 'R Brow Angle*', min: -1, max: 1, step: 0.1, defaultValue: 0 },
  { id: 'ParamCheek', label: 'Cheek Blush', min: 0, max: 1, step: 0.1, defaultValue: 0 },
  { id: 'ParamAngleX', label: 'Head Angle X', min: -30, max: 30, step: 1, defaultValue: 0 },
  { id: 'ParamAngleY', label: 'Head Angle Y', min: -30, max: 30, step: 1, defaultValue: 0 },
  { id: 'ParamAngleZ', label: 'Head Angle Z', min: -30, max: 30, step: 1, defaultValue: 0 },
]

const STORAGE_KEY = 'yumi-expression-presets'

// Native expressions available in the model
const NATIVE_EXPRESSIONS = [
  'neutral', 'happy', 'sad', 'surprised', 'smiling', 'scared', 'thinking'
]

export function ExpressionDebugPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [values, setValues] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {}
    PARAMETERS.forEach(p => { initial[p.id] = p.defaultValue })
    return initial
  })
  const [presets, setPresets] = useState<ExpressionPreset[]>([])
  const [presetName, setPresetName] = useState('')
  const [isLive, setIsLive] = useState(true)

  // Load presets from storage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        setPresets(JSON.parse(stored))
      } catch (e) {
        console.error('[ExpressionDebug] Failed to load presets:', e)
      }
    }
  }, [])

  // Save presets to storage
  const savePresetsToStorage = useCallback((newPresets: ExpressionPreset[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newPresets))
    setPresets(newPresets)
  }, [])

  // Apply current values to the model
  const applyToModel = useCallback((vals: Record<string, number>) => {
    const win = window as any
    if (win.__yumiDebugSetParams) {
      win.__yumiDebugSetParams(vals)
    }
  }, [])

  // Set expression using native pixi-live2d-display system
  const setNativeExpression = useCallback((name: string) => {
    const win = window as any
    if (win.__yumiExpression?.set) {
      // Disable debug panel mode first so expression can take effect
      if (win.__yumiDebugDisable) {
        win.__yumiDebugDisable()
      }
      setIsLive(false)
      win.__yumiExpression.set(name)
    }
  }, [])

  // Disable debug mode (return to normal expressions)
  const disableDebugMode = useCallback(() => {
    const win = window as any
    if (win.__yumiDebugDisable) {
      win.__yumiDebugDisable()
    }
  }, [])

  // Handle slider change
  const handleChange = (paramId: string, value: number) => {
    const newValues = { ...values, [paramId]: value }
    setValues(newValues)
    if (isLive) {
      applyToModel(newValues)
    }
  }

  // Save current values as preset
  const savePreset = () => {
    if (!presetName.trim()) {
      alert('Please enter a preset name')
      return
    }

    const newPreset: ExpressionPreset = {
      name: presetName.trim().toLowerCase(),
      values: { ...values },
      createdAt: Date.now()
    }

    // Replace if exists, otherwise add
    const existing = presets.findIndex(p => p.name === newPreset.name)
    const newPresets = existing >= 0
      ? presets.map((p, i) => i === existing ? newPreset : p)
      : [...presets, newPreset]

    savePresetsToStorage(newPresets)
    setPresetName('')
    console.log(`[ExpressionDebug] Saved preset: ${newPreset.name}`, newPreset.values)
  }

  // Load preset
  const loadPreset = (preset: ExpressionPreset) => {
    setValues(preset.values)
    if (isLive) {
      applyToModel(preset.values)
    }
  }

  // Delete preset
  const deletePreset = (name: string) => {
    const newPresets = presets.filter(p => p.name !== name)
    savePresetsToStorage(newPresets)
  }

  // Reset to defaults
  const resetToDefaults = () => {
    const defaults: Record<string, number> = {}
    PARAMETERS.forEach(p => { defaults[p.id] = p.defaultValue })
    setValues(defaults)
    if (isLive) {
      applyToModel(defaults)
    }
  }

  // Export presets as JSON
  const exportPresets = () => {
    const json = JSON.stringify(presets, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'yumi-expression-presets.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Copy current values as code
  const copyAsCode = () => {
    const code = `// Expression: ${presetName || 'unnamed'}
{
${Object.entries(values)
  .filter(([_, v]) => v !== 0 && v !== 1) // Only non-default values
  .map(([k, v]) => `  ${k.replace('Param', '').toLowerCase()}: ${v}`)
  .join(',\n')}
}`
    navigator.clipboard.writeText(code)
    console.log('[ExpressionDebug] Copied to clipboard')
  }

  // Handle closing the panel
  const handleClose = () => {
    setIsOpen(false)
    disableDebugMode()
  }

  // Handle toggling live mode
  const handleToggleLive = (enabled: boolean) => {
    setIsLive(enabled)
    if (enabled) {
      applyToModel(values)
    } else {
      disableDebugMode()
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 left-4 z-[99999] bg-purple-600 text-white px-3 py-2 rounded-lg shadow-lg hover:bg-purple-700 text-sm font-medium"
      >
        🎭 Expression Debug
      </button>
    )
  }

  return (
    <div className="fixed bottom-4 left-4 z-[99999] w-80 max-h-[80vh] bg-gray-900 text-white rounded-lg shadow-2xl overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
        <h3 className="font-semibold text-sm">🎭 Expression Debug</h3>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={isLive}
              onChange={(e) => handleToggleLive(e.target.checked)}
              className="w-3 h-3"
            />
            Live
          </label>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Quick Expression Buttons */}
      <div className="px-3 pt-3 pb-2 border-b border-gray-700">
        <div className="text-xs text-gray-400 mb-2">Quick Expressions</div>
        <div className="flex flex-wrap gap-1">
          {NATIVE_EXPRESSIONS.map(expr => (
            <button
              key={expr}
              onClick={() => setNativeExpression(expr)}
              className="px-2 py-1 text-xs bg-purple-600 hover:bg-purple-500 rounded capitalize transition-colors"
            >
              {expr}
            </button>
          ))}
        </div>
      </div>

      {/* Sliders */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {PARAMETERS.map(param => (
          <div key={param.id} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-gray-300">{param.label}</span>
              <span className="text-purple-400 font-mono">{values[param.id]?.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min={param.min}
              max={param.max}
              step={param.step}
              value={values[param.id] ?? param.defaultValue}
              onChange={(e) => handleChange(param.id, parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
            />
          </div>
        ))}
      </div>

      {/* Presets Section */}
      <div className="border-t border-gray-700 p-3 space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="Preset name (e.g., happy)"
            className="flex-1 px-2 py-1 text-xs bg-gray-800 border border-gray-600 rounded focus:outline-none focus:border-purple-500"
          />
          <button
            onClick={savePreset}
            className="px-3 py-1 text-xs bg-purple-600 hover:bg-purple-700 rounded font-medium"
          >
            Save
          </button>
        </div>

        {/* Saved Presets */}
        {presets.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {presets.map(preset => (
              <div key={preset.name} className="flex items-center gap-1 bg-gray-800 rounded px-2 py-1">
                <button
                  onClick={() => loadPreset(preset)}
                  className="text-xs text-purple-300 hover:text-purple-100"
                >
                  {preset.name}
                </button>
                <button
                  onClick={() => deletePreset(preset.name)}
                  className="text-gray-500 hover:text-red-400 text-xs"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={resetToDefaults}
            className="flex-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded"
          >
            Reset
          </button>
          <button
            onClick={copyAsCode}
            className="flex-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded"
          >
            Copy Code
          </button>
          <button
            onClick={exportPresets}
            className="flex-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded"
          >
            Export
          </button>
        </div>
      </div>
    </div>
  )
}
