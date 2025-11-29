export interface SelectionSpotterConfig {
  enabled: boolean
  minSelectionLength: number
  maxSelectionLength: number
  debounceMs: number
  ignoreInputFields: boolean
}

export interface ScrollCompanionConfig {
  enabled: boolean
  commentIntervalMs: number
  minScrollDistance: number
  throttleMs: number
  disabledDomains: string[]
}

export interface ImageUnderstandingConfig {
  enabled: boolean
  maxImageSize: number
}

export interface VisionConfig {
  selectionSpotter: SelectionSpotterConfig
  scrollCompanion: ScrollCompanionConfig
  imageUnderstanding: ImageUnderstandingConfig
}

export const DEFAULT_VISION_CONFIG: Readonly<VisionConfig> = {
  selectionSpotter: {
    enabled: true,
    minSelectionLength: 10,
    maxSelectionLength: 2000,
    debounceMs: 500,
    ignoreInputFields: true,
  },
  scrollCompanion: {
    enabled: false, // Disabled by default (can be intrusive)
    commentIntervalMs: 15000,
    minScrollDistance: 200,
    throttleMs: 2000,
    disabledDomains: [],
  },
  imageUnderstanding: {
    enabled: true,
    maxImageSize: 512, // Reduced from 800 for lower token usage
  },
}

export function mergeVisionConfig(
  stored: Partial<VisionConfig> | undefined
): VisionConfig {
  if (!stored) return { ...DEFAULT_VISION_CONFIG }
  return {
    selectionSpotter: { ...DEFAULT_VISION_CONFIG.selectionSpotter, ...stored.selectionSpotter },
    scrollCompanion: { ...DEFAULT_VISION_CONFIG.scrollCompanion, ...stored.scrollCompanion },
    imageUnderstanding: { ...DEFAULT_VISION_CONFIG.imageUnderstanding, ...stored.imageUnderstanding },
  }
}
