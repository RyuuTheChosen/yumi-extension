import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { useSettingsStore } from '../lib/stores/settings.store'
import { usePersonalityStore } from '../lib/stores/personality.store'
import '../styles/tailwind.css'
import { createLogger } from '../lib/core/debug'

const log = createLogger('Popup')

// Rehydrate stores before rendering (required when skipHydration: true)
log.log('Rehydrating stores...')
useSettingsStore.persist.rehydrate()
usePersonalityStore.persist.rehydrate()

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
