import { extractMainContent } from './extract'
import { bus } from '../lib/core/bus'
import { createLogger } from '../lib/core/debug'
import { detectPageType } from '../lib/memory'
import { getActiveCompanion, checkAndSyncActiveCompanion } from '../lib/companions/loader'
import { registerBuiltinPlugins, loadPluginsForCompanion } from '../lib/plugins'

const log = createLogger('Content')

/**
 * Register all builtin plugins in the content script context.
 * This must happen before any companion loads to ensure plugins are available.
 */
registerBuiltinPlugins()
log.log('Builtin plugins registered')

// Lazy-loaded avatar module (300KB+ bundle only loaded when needed)
let overlayModule: typeof import('./overlayAvatar') | null = null

async function getOverlayModule() {
	if (!overlayModule) {
		log.log('Loading avatar bundle...')
		overlayModule = await import('./overlayAvatar')
		log.log('Avatar bundle loaded')
	}
	return overlayModule
}

async function mountOverlay(config: Parameters<typeof import('./overlayAvatar').mountOverlay>[0]) {
	const mod = await getOverlayModule()
	mod.mountOverlay(config)
}

async function unmountOverlay() {
	// Only unmount if module was loaded (avoid loading just to unmount)
	if (overlayModule) {
		overlayModule.unmountOverlay()
	}
}

function updateOverlayConfig(config: Parameters<typeof import('./overlayAvatar').updateOverlayConfig>[0]): boolean {
	// Only update if module was loaded (sync check for lightweight updates)
	if (overlayModule) {
		return overlayModule.updateOverlayConfig(config)
	}
	return false
}
import { visionAbilities } from './visionAbilities'
import './contextMenuHandler' // Initialize context menu handling

// Expression state management
let expressionResetTimer: number | null = null

// Handle avatar events and trigger expressions
bus.on('avatar', (event) => {
	const expr = (window as any).__yumiExpression
	if (!expr) return

	// Clear any pending reset timer
	if (expressionResetTimer) {
		clearTimeout(expressionResetTimer)
		expressionResetTimer = null
	}

	switch (event.type) {
		case 'thinking:start':
			// Thinking expression while AI is generating
			expr.set('thinking')
			log.log(' Expression: thinking')
			break
		case 'thinking:stop':
			// Brief happy expression when response completes
			expr.set('happy')
			log.log(' Expression: happy')
			// Reset to neutral after a moment
			expressionResetTimer = window.setTimeout(() => {
				expr.reset()
				log.log(' Expression: reset to neutral')
			}, 2000)
			break
		case 'speaking:start':
			// Excited/talking expression during TTS
			expr.set('happy')
			log.log(' Expression: speaking (happy)')
			break
		case 'speaking:stop':
			// Return to neutral after speaking
			expressionResetTimer = window.setTimeout(() => {
				expr.reset()
				log.log(' Expression: reset after speaking')
			}, 500)
			break
	}
})

// Listen for avatar events from sidepanel (cross-context communication)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.type === 'AVATAR_EVENT' && message.payload) {
		log.log(' Received avatar event:', message.payload)
		bus.emit('avatar', message.payload)
	}

	// Handle companion change notification from background (for uninstall remount)
	if (message.type === 'COMPANION_CHANGED' && message.payload?.slug) {
		log.log(' Received companion change notification:', message.payload.slug)
		handleCompanionChange(message.payload.slug)
	}
})

// Handle companion change notification - remount with new companion
async function handleCompanionChange(newSlug: string) {
	try {
		// Check if overlay is enabled and user is logged in
		const data = await chrome.storage.local.get('settings-store')
		let store
		if (typeof data?.['settings-store'] === 'string') {
			store = JSON.parse(data['settings-store'])
		} else {
			store = data?.['settings-store']
		}

		const hubAccessToken = store?.state?.hubAccessToken
		const enableOverlay = !!store?.state?.enableLive2D

		if (!hubAccessToken || !enableOverlay) {
			log.log(' Not logged in or overlay disabled, skipping companion change')
			return
		}

		// Load and mount the new companion
		const companion = await getActiveCompanion(newSlug)

		// Reload plugins for the new companion
		const plugins = await loadPluginsForCompanion(companion.personality.capabilities)
		log.log(' Plugins reloaded for companion change:', plugins.map(p => p.manifest.id))

		// Initialize vision abilities after plugins are loaded
		visionAbilities.init()

		const scale = typeof store?.state?.live2DScale === 'number' ? store.state.live2DScale : 0.5
		const modelOffsetX = typeof store?.state?.modelOffsetX === 'number' ? store.state.modelOffsetX : 0
		const modelOffsetY = typeof store?.state?.modelOffsetY === 'number' ? store.state.modelOffsetY : 0
		const modelScaleMultiplier = typeof store?.state?.modelScaleMultiplier === 'number' ? store.state.modelScaleMultiplier : 1.0

		log.log(' Remounting with new companion:', companion.manifest.id)
		mountOverlay({ modelUrl: companion.modelUrl, scale, position: 'bottom-right', modelOffsetX, modelOffsetY, modelScaleMultiplier })
	} catch (e) {
		log.error(' Failed to handle companion change:', e)
	}
}

async function indexPage() {
	try {
		const text = extractMainContent(document as Document)
		chrome.runtime.sendMessage({ type: 'index:add', payload: { url: location.href, text } })
	} catch (e) {
		log.warn('Yumi index error', e)
	}
}

// Index on idle to avoid jank
if (document.readyState === 'complete') indexPage()
else window.addEventListener('load', indexPage)

// Mount overlay based on persisted settings and active companion
async function maybeMountOverlay() {
	try {
		log.log(' Checking overlay settings...')
		// Pull persisted zustand state (partial)
		const data = await chrome.storage.local.get('settings-store')
		log.log(' Storage data:', data)

		// Parse the JSON string stored by zustand-chrome-storage
		let store
		if (typeof data?.['settings-store'] === 'string') {
			store = JSON.parse(data['settings-store'])
			log.log(' Parsed store:', store)
		} else {
			store = data?.['settings-store']
		}

		// Check Hub authentication - require login to use extension
		const hubAccessToken = store?.state?.hubAccessToken
		if (!hubAccessToken) {
			log.log(' Not authenticated with Hub, skipping overlay')
			return
		}

		const activeSlug = store?.state?.activeCompanionSlug || 'yumi'
		const enableOverlay = !!store?.state?.enableLive2D
		log.log(' Enable overlay:', enableOverlay)
		if (!enableOverlay) {
			log.log(' Overlay disabled, skipping mount')
			return
		}

		log.log(' Loading active companion:', activeSlug)

		// Load companion (installed from IndexedDB or bundled fallback)
		const companion = await getActiveCompanion(activeSlug)
		log.log(' Loaded companion:', companion.manifest.id)

		// Initialize plugins based on companion capabilities
		const plugins = await loadPluginsForCompanion(companion.personality.capabilities)
		log.log(' Plugins loaded:', plugins.map(p => p.manifest.id))

		// Initialize vision abilities after plugins are loaded
		visionAbilities.init()

		// Use companion's model URL (either blob URL from IndexedDB or extension URL for bundled)
		const resolvedUrl = companion.modelUrl
		const scale = typeof store?.state?.live2DScale === 'number' ? store.state.live2DScale : 0.5
		const modelOffsetX = typeof store?.state?.modelOffsetX === 'number' ? store.state.modelOffsetX : 0
		const modelOffsetY = typeof store?.state?.modelOffsetY === 'number' ? store.state.modelOffsetY : 0
		const modelScaleMultiplier = typeof store?.state?.modelScaleMultiplier === 'number' ? store.state.modelScaleMultiplier : 1.0
		log.log(' Mounting overlay with:', { modelUrl: resolvedUrl, scale, position: 'bottom-right', modelOffsetX, modelOffsetY, modelScaleMultiplier })
		mountOverlay({ modelUrl: resolvedUrl, scale, position: 'bottom-right', modelOffsetX, modelOffsetY, modelScaleMultiplier })
	} catch (e) {
		log.error(' Overlay mount failed:', e)
	}
}

maybeMountOverlay()

/** Background sync check for companion updates from Hub */
async function runBackgroundSync() {
	try {
		const data = await chrome.storage.local.get('settings-store')
		let store
		if (typeof data?.['settings-store'] === 'string') {
			store = JSON.parse(data['settings-store'])
		} else {
			store = data?.['settings-store']
		}

		const activeSlug = store?.state?.activeCompanionSlug || 'yumi'

		log.log(' Running background companion sync check for:', activeSlug)
		const result = await checkAndSyncActiveCompanion(activeSlug)

		if (result.synced && result.newCapabilities) {
			log.log(' Companion updated with new capabilities, reloading plugins')
			await loadPluginsForCompanion(result.newCapabilities)
		}
	} catch (e) {
		log.warn(' Background sync check failed:', e)
	}
}

/** Run sync check after a delay to avoid blocking initial page load */
setTimeout(runBackgroundSync, 5000)

// Emit page:ready for proactive system (after a brief delay for page to settle)
setTimeout(() => {
	bus.emit('page:ready', {
		url: window.location.href,
		origin: window.location.origin,
		title: document.title,
		pageType: detectPageType(window.location.href, document.title),
	})
	log.log(' Emitted page:ready')
}, 1500)

chrome.storage.onChanged.addListener(async (changes, area) => {
	if (area !== 'local') return
	if (!changes['settings-store']) return
	log.log(' Settings changed:', changes['settings-store'])

	/** Parse the JSON strings stored by zustand-chrome-storage */
	let oldVal, newVal
	const rawOldVal = changes['settings-store'].oldValue
	const rawNewVal = changes['settings-store'].newValue

	if (typeof rawOldVal === 'string') {
		try {
			oldVal = JSON.parse(rawOldVal)
		} catch {
			log.warn(' Failed to parse oldValue, using undefined')
			oldVal = undefined
		}
	} else {
		oldVal = rawOldVal
	}

	if (typeof rawNewVal === 'string') {
		try {
			newVal = JSON.parse(rawNewVal)
		} catch {
			log.warn(' Failed to parse newValue, using undefined')
			newVal = undefined
		}
	} else {
		newVal = rawNewVal
	}

	const oldState = oldVal?.state
	const newState = newVal?.state

	// Check if Hub auth changed (login/logout)
	const authChanged = oldState?.hubAccessToken !== newState?.hubAccessToken
	const wasLoggedIn = !!oldState?.hubAccessToken
	const isLoggedIn = !!newState?.hubAccessToken

	if (authChanged) {
		log.log(' Hub auth changed:', { wasLoggedIn, isLoggedIn })

		if (!isLoggedIn) {
			// User logged out - unmount overlay
			log.log(' User logged out, unmounting overlay')
			unmountOverlay()
			return
		} else if (isLoggedIn && !wasLoggedIn) {
			// User logged in - load companion, plugins, and mount overlay if enabled
			log.log(' User logged in, loading companion and plugins')

			const activeSlug = newState?.activeCompanionSlug || 'yumi'

			try {
				const companion = await getActiveCompanion(activeSlug)

				// Initialize plugins for the companion
				const plugins = await loadPluginsForCompanion(companion.personality.capabilities)
				log.log(' Plugins loaded on login:', plugins.map(p => p.manifest.id))

				// Initialize vision abilities after plugins are loaded
				visionAbilities.init()

				if (newState?.enableLive2D) {
					const scale = typeof newState?.live2DScale === 'number' ? newState.live2DScale : 0.5
					const modelOffsetX = typeof newState?.modelOffsetX === 'number' ? newState.modelOffsetX : 0
					const modelOffsetY = typeof newState?.modelOffsetY === 'number' ? newState.modelOffsetY : 0
					const modelScaleMultiplier = typeof newState?.modelScaleMultiplier === 'number' ? newState.modelScaleMultiplier : 1.0
					mountOverlay({ modelUrl: companion.modelUrl, scale, position: 'bottom-right', modelOffsetX, modelOffsetY, modelScaleMultiplier })
				}
			} catch (e) {
				log.error(' Failed to initialize on login:', e)
			}
			return
		}
	}

	// If not logged in, don't process other changes
	if (!isLoggedIn) {
		log.log(' Not logged in, ignoring settings changes')
		return
	}

	// Check if avatar-related fields actually changed (avoid remount on AI model changes)
	const avatarChanged =
		oldState?.enableLive2D !== newState?.enableLive2D ||
		oldState?.activeCompanionSlug !== newState?.activeCompanionSlug ||
		oldState?.live2DScale !== newState?.live2DScale ||
		oldState?.modelOffsetX !== newState?.modelOffsetX ||
		oldState?.modelOffsetY !== newState?.modelOffsetY ||
		oldState?.modelScaleMultiplier !== newState?.modelScaleMultiplier

	if (!avatarChanged) {
		log.log(' Non-avatar settings changed, skipping overlay remount')
		return
	}

	log.log(' Avatar settings changed:', {
		enableLive2D: `${oldState?.enableLive2D} → ${newState?.enableLive2D}`,
		activeCompanion: `${oldState?.activeCompanionSlug} → ${newState?.activeCompanionSlug}`,
		scale: `${oldState?.live2DScale} → ${newState?.live2DScale}`,
		modelOffsetX: `${oldState?.modelOffsetX} → ${newState?.modelOffsetX}`,
		modelOffsetY: `${oldState?.modelOffsetY} → ${newState?.modelOffsetY}`,
		modelScaleMultiplier: `${oldState?.modelScaleMultiplier} → ${newState?.modelScaleMultiplier}`
	})

	const enableOverlay = !!newState?.enableLive2D

	if (enableOverlay) {
		const scale = typeof newState?.live2DScale === 'number' ? newState.live2DScale : 0.5
		const modelOffsetX = typeof newState?.modelOffsetX === 'number' ? newState.modelOffsetX : 0
		const modelOffsetY = typeof newState?.modelOffsetY === 'number' ? newState.modelOffsetY : 0
		const modelScaleMultiplier = typeof newState?.modelScaleMultiplier === 'number' ? newState.modelScaleMultiplier : 1.0

		// Check if companion changed (requires full remount with new model)
		const companionChanged = oldState?.activeCompanionSlug !== newState?.activeCompanionSlug

		if (companionChanged) {
			log.log(' Active companion changed, loading new companion...')
			try {
				const activeSlug = newState?.activeCompanionSlug || 'yumi'
				const companion = await getActiveCompanion(activeSlug)
				log.log(' Loaded companion:', companion.manifest.id)
				mountOverlay({ modelUrl: companion.modelUrl, scale, position: 'bottom-right', modelOffsetX, modelOffsetY, modelScaleMultiplier })
			} catch (e) {
				log.error(' Failed to load companion:', e)
			}
		} else {
			// Try lightweight update first (scale/position/model adjustments)
			const updated = updateOverlayConfig({ scale, position: 'bottom-right', modelOffsetX, modelOffsetY, modelScaleMultiplier })

			if (!updated) {
				// Fallback: overlay doesn't exist yet, do full mount
				log.log(' Overlay not mounted, doing initial mount')
				try {
					const activeSlug = newState?.activeCompanionSlug || 'yumi'
					const companion = await getActiveCompanion(activeSlug)
					mountOverlay({ modelUrl: companion.modelUrl, scale, position: 'bottom-right', modelOffsetX, modelOffsetY, modelScaleMultiplier })
				} catch (e) {
					log.error(' Failed to load companion:', e)
				}
			}
		}
	} else {
		log.log(' Unmounting overlay')
		unmountOverlay()
	}
})
