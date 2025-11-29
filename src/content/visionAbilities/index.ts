import { SelectionSpotter } from './SelectionSpotter'
import { ImageUnderstanding } from './ImageUnderstanding'
import { injectVisionStyles } from './utils'
import { mergeVisionConfig } from '../../lib/types/visionConfig'
import type { VisionConfig } from '../../lib/types/visionConfig'

class VisionAbilitiesManager {
  private config: VisionConfig | null = null
  private selectionSpotter: SelectionSpotter | null = null
  private imageUnderstanding: ImageUnderstanding | null = null

  async init() {
    await this.loadConfig()
    injectVisionStyles()

    if (this.config?.selectionSpotter.enabled) {
      this.selectionSpotter = new SelectionSpotter(this.config.selectionSpotter)
    }

    if (this.config?.imageUnderstanding.enabled) {
      this.imageUnderstanding = new ImageUnderstanding(this.config.imageUnderstanding)
    }

    console.log('[VisionAbilities] ✅ Initialized')
  }

  private async loadConfig() {
    try {
      const data = await chrome.storage.local.get('vision-abilities-config')
      this.config = mergeVisionConfig(data['vision-abilities-config'])
      console.log('[VisionAbilities] Config loaded:', this.config)
    } catch (err) {
      console.warn('[VisionAbilities] Failed to load config, using defaults', err)
      this.config = mergeVisionConfig(undefined)
    }
  }

  destroy() {
    this.selectionSpotter?.destroy()
    this.imageUnderstanding?.destroy()
  }
}

export const visionAbilities = new VisionAbilitiesManager()

// Auto-init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => visionAbilities.init())
} else {
  visionAbilities.init()
}
