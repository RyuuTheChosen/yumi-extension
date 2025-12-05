import React, { useState, useEffect } from 'react'
import { SettingsPanel } from './components/SettingsPanel'
import { useSettingsStore } from '../lib/stores/settings.store'
import { usePersonalityStore } from '../lib/stores/personality.store'
import { createLogger } from '../lib/debug'

const log = createLogger('Popup')

// Hydration gate hook following Zustand best practices
function useHydration() {
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    // Check if already hydrated (handles fast hydration)
    const checkBothHydrated = () => {
      const settingsReady = useSettingsStore.persist.hasHydrated()
      const personalityReady = usePersonalityStore.persist.hasHydrated()
      
      log.log('Hydration check:', { settingsReady, personalityReady })

      if (settingsReady && personalityReady) {
        log.log('All stores hydrated, rendering UI')
        setHydrated(true)
      }
    }
    
    // Subscribe to hydration completion for both stores
    const unsubSettings = useSettingsStore.persist.onFinishHydration(() => {
      log.log('Settings store hydrated')
      checkBothHydrated()
    })

    const unsubPersonality = usePersonalityStore.persist.onFinishHydration(() => {
      log.log('Personality store hydrated')
      checkBothHydrated()
    })
    
    // Initial check in case stores are already hydrated
    checkBothHydrated()
    
    return () => {
      unsubSettings()
      unsubPersonality()
    }
  }, [])

  return hydrated
}

export function App() {
  const hydrated = useHydration()
  
  if (!hydrated) {
    return (
      <div className="w-[400px] h-[500px] flex items-center justify-center" style={{ background: 'rgba(20, 20, 20, 0.95)' }}>
        <div className="text-center space-y-3">
          <div className="relative w-12 h-12 mx-auto">
            <div className="absolute inset-0 rounded-full border-2 border-white/20"></div>
            <div className="absolute inset-0 rounded-full border-2 border-white border-t-transparent animate-spin"></div>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-white">Loading Yumi...</p>
            <p className="text-xs text-white/50">Preparing your settings</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-[400px] h-[500px]" style={{ background: 'rgba(20, 20, 20, 0.95)' }}>
      <SettingsPanel />
    </div>
  )
}
