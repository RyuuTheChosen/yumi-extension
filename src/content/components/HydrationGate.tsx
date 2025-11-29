/**
 * HydrationGate Component
 * 
 * Blocks rendering until all persisted Zustand stores have hydrated from chrome.storage.
 * Prevents React from accessing undefined store values during async hydration.
 */

import React from 'react'
import { usePersonalityStore } from '../../lib/stores/personality.store'
import { useSettingsStore } from '../../lib/stores/settings.store'

interface HydrationGateProps {
  children: React.ReactNode
}

export function HydrationGate({ children }: HydrationGateProps) {
  // Check if all persisted stores have completed hydration
  const personalityHydrated = usePersonalityStore.persist.hasHydrated()
  const settingsHydrated = useSettingsStore.persist.hasHydrated()
  
  const allHydrated = personalityHydrated && settingsHydrated
  
  if (!allHydrated) {
    return (
      <div
        style={{
          padding: '20px',
          textAlign: 'center',
          color: 'rgba(255, 255, 255, 0.5)',
          fontSize: '14px'
        }}
      >
        <div>Loading Yumi...</div>
      </div>
    )
  }
  
  return <>{children}</>
}
