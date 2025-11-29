/**
 * Centralized dimension constants for consistent sizing across components.
 * Extracted from hardcoded values to enable easier adjustments.
 */

export const CHAT = {
  /** Chat overlay width in pixels */
  width: 320,
  /** Chat overlay height in pixels */
  height: 380,
  /** Border radius for the chat container */
  borderRadius: 12,
  /** Padding inside the messages area */
  padding: 12,
  /** Top padding for header clearance */
  headerClearance: 40,
} as const

export const MESSAGE_INPUT = {
  /** Maximum height for the textarea before scrolling */
  textareaMaxHeight: 120,
  /** Maximum character count for a single message */
  maxMessageLength: 2000,
} as const

export const AVATAR = {
  /** Base width for the Live2D canvas */
  baseWidth: 300,
  /** Base height for the Live2D canvas */
  baseHeight: 350,
  /** Model padding (1.0 = 100% of container) */
  padding: 1.0,
} as const

export const FLOATING_BUBBLE = {
  /** Maximum width for vision response bubbles */
  maxWidth: 320,
  /** Maximum height for vision response bubbles */
  maxHeight: 200,
  /** Minimum width for bubbles */
  minWidth: 200,
} as const

export const BREAKPOINTS = {
  /** Screen width below which narrow layout is used */
  narrow: 1200,
} as const
