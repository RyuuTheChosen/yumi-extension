/**
 * Vision System Type Definitions
 *
 * Types for vision query handling, screenshot processing, and image understanding.
 */

/**
 * Vision query payload sent to background worker
 */
export interface VisionQueryPayload {
  text: string
  imageBase64?: string
  source: 'selection-spotter' | 'image-understanding'
  requestId: string
  scopeId: string
}

/**
 * Vision query response from AI
 */
export interface VisionQueryResponse {
  requestId: string
  content: string
  error?: string
}

/**
 * Screenshot capture options
 */
export interface ScreenshotOptions {
  format?: 'png' | 'jpeg'
  quality?: number // 0-100 for JPEG
}

/**
 * Screenshot result
 */
export interface ScreenshotResult {
  dataUrl: string
  width: number
  height: number
  format: string
}

/**
 * Image element metadata
 */
export interface ImageElementInfo {
  src: string
  alt?: string
  width: number
  height: number
  naturalWidth: number
  naturalHeight: number
}

/**
 * Vision API request
 */
export interface VisionAPIRequest {
  model: string
  messages: Array<{
    role: 'user' | 'assistant' | 'system'
    content: string | Array<{
      type: 'text' | 'image_url'
      text?: string
      image_url?: {
        url: string
      }
    }>
  }>
  max_tokens?: number
  temperature?: number
}

/**
 * Vision capability detection
 */
export interface VisionCapability {
  hasVisionModel: boolean
  model: string
  maxImageSize: number
  supportedFormats: string[]
}
