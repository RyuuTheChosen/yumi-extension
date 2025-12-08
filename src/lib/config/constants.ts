/**
 * Application Constants
 *
 * Centralized constants to replace magic numbers throughout the codebase.
 * All limits, timeouts, debounce values, and other configuration constants
 * are defined here for easy maintenance and consistency.
 */

/**
 * Resource Limits
 */
export const LIMITS = {
  MAX_TOKENS_DEFAULT: 1000,
  MAX_CONTENT_LENGTH: 5000,
  MAX_CONTEXT_CHARS: 3000,
  MAX_MESSAGES_PER_THREAD: 100,
  MAX_MEMORIES_TOTAL: 500,
  MAX_MEMORIES_PER_TYPE: 100,
  MAX_MEMORY_SIZE_MB: 5,
  MAX_QUEUE_SIZE_AUDIO: 10,
  MAX_COMPANION_SIZE_MB: 50,
  MAX_SEARCH_RESULTS: 5,
} as const

/**
 * Timeout Values (milliseconds)
 */
export const TIMEOUTS = {
  ERROR_DISPLAY_MS: 4000,
  MIC_RESET_MS: 1500,
  EXTRACTION_IDLE_MS: 30000,
  EXTRACTION_INTERVAL_MS: 300000,
  HEARTBEAT_INTERVAL_MS: 15000,
  API_REQUEST_TIMEOUT_MS: 30000,
  SEARCH_CACHE_TTL_MS: 300000,
  COPY_FEEDBACK_MS: 2000,
} as const

/**
 * Debounce Values (milliseconds)
 */
export const DEBOUNCE = {
  CHROME_STORAGE_MS: 100,
  SEARCH_INPUT_MS: 300,
} as const

/**
 * Audio Processing Constants
 */
export const AUDIO = {
  SPEECH_RANGE_HZ: { min: 172, max: 3956 },
  FFT_BINS_SPEECH: { start: 1, end: 23 },
  SCREENSHOT_JPEG_QUALITY: 70,
} as const

/**
 * Z-Index Layers
 */
export const ZINDEX = {
  OVERLAY_MAX: 2147483647,
  CHAT_OVERLAY: 2147483646,
  PROACTIVE_BUBBLE: 2147483645,
} as const

/**
 * Memory System Constants
 */
export const MEMORY = {
  JACCARD_SIMILARITY_THRESHOLD: 0.6,
  MIN_CONFIDENCE: 0.6,
  MAX_EXTRACTION_COUNT: 10,
  DECAY_RATE_DAYS: 30,
  TFIDF_TOP_KEYWORDS: 5,
} as const

/**
 * API & Network Constants
 */
export const API = {
  RATE_LIMIT_REQUESTS_PER_MINUTE: 100,
  MONTHLY_QUOTA: 100,
  VISION_MAX_TOKENS: 800,
  CHAT_MAX_TOKENS: 300,
  MEMORY_EXTRACTION_MAX_TOKENS: 1000,
} as const

/**
 * Cache Limits
 */
export const CACHE = {
  MAX_SEARCH_CACHE_ENTRIES: 100,
  MAX_SCOPE_BUDGET_CHARS: 16000,
} as const

/**
 * Authentication Constants
 */
export const AUTH = {
  JWT_ACCESS_TOKEN_DAYS: 7,
  JWT_REFRESH_TOKEN_DAYS: 30,
  RATE_LIMIT_AUTH_REQUESTS_PER_MINUTE: 5,
} as const

/**
 * Model Configuration
 */
export const MODELS = {
  CHAT_DEFAULT: 'deepseek-chat',
  VISION_DEFAULT: 'gpt-4o-mini',
  MEMORY_EXTRACTION: 'deepseek-chat',
} as const

/**
 * Temperature & Sampling Parameters
 */
export const SAMPLING = {
  CHAT_TEMPERATURE: 0.8,
  CHAT_TOP_P: 0.9,
  CHAT_PRESENCE_PENALTY: 0.4,
  CHAT_FREQUENCY_PENALTY: 0.3,
  VISION_TEMPERATURE: 0.7,
  MEMORY_EXTRACTION_TEMPERATURE: 0.3,
} as const

/**
 * Storage Keys
 */
export const STORAGE_KEYS = {
  SETTINGS: 'settings-store',
  PERSONALITY: 'personality-store',
  CHAT_DB: 'yumi-chat',
  MEMORY_DB: 'yumi-memory',
} as const

/**
 * Context Menu IDs
 */
export const CONTEXT_MENU_IDS = {
  ANALYZE_IMAGE: 'yumi-analyze-image',
  ANALYZE_SELECTION: 'yumi-analyze-selection',
  READ_ELEMENT: 'yumi-read-element',
} as const

/**
 * Message Types
 */
export const MESSAGE_TYPES = {
  STREAM_CHUNK: 'STREAM_CHUNK',
  STREAM_END: 'STREAM_END',
  STREAM_ERROR: 'STREAM_ERROR',
  VISION_QUERY: 'VISION_QUERY',
  VISION_STAGE: 'VISION_STAGE',
  MEMORY_EXTRACTION: 'MEMORY_EXTRACTION',
  SEND_MESSAGE: 'SEND_MESSAGE',
  HEARTBEAT: 'HEARTBEAT',
  PONG: 'PONG',
  ANALYZE_IMAGE: 'ANALYZE_IMAGE',
  CONTEXT_MENU_SELECTION: 'CONTEXT_MENU_SELECTION',
  CONTEXT_MENU_READ_ELEMENT: 'CONTEXT_MENU_READ_ELEMENT',
  FETCH_IMAGE: 'FETCH_IMAGE',
  FETCH_IMAGE_RESULT: 'FETCH_IMAGE_RESULT',
  CAPTURE_SCREENSHOT: 'CAPTURE_SCREENSHOT',
  SEARCH_REQUEST: 'SEARCH_REQUEST',
} as const

/**
 * Port Names
 */
export const PORT_NAMES = {
  CHAT: 'yumi-chat',
} as const

/**
 * Vision Query Sources
 */
export const VISION_SOURCES = {
  SELECTION_SPOTTER: 'selection-spotter',
  IMAGE_UNDERSTANDING: 'image-understanding',
} as const

/**
 * Memory Types
 */
export const MEMORY_TYPES = {
  IDENTITY: 'identity',
  PREFERENCE: 'preference',
  SKILL: 'skill',
  PROJECT: 'project',
  PERSON: 'person',
  EVENT: 'event',
  OPINION: 'opinion',
} as const

/**
 * Vision Stages
 */
export const VISION_STAGES = {
  ANALYZING: 'analyzing',
  THINKING: 'thinking',
  ERROR: 'error',
  TIMEOUT: 'timeout',
} as const
