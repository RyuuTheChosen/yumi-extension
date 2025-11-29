import { z } from 'zod'

/**
 * Companion Package Spec v1
 *
 * A companion package contains:
 * - companion.json (manifest)
 * - personality.json (AI personality config)
 * - preview.png (512x512 preview image)
 * - model/ (Live2D model files)
 */

// Model configuration
export const companionModelSchema = z.object({
  entry: z.string(),  // Path to model.model3.json
  scale: z.number().default(0.15),
  position: z.enum(['bottom-right', 'bottom-left']).default('bottom-right'),
})

// Companion manifest (companion.json)
export const companionManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(48),
  version: z.string().default('1.0.0'),
  description: z.string().max(500).default(''),
  author: z.string().default('Unknown'),
  preview: z.string().default('preview.png'),
  model: companionModelSchema,
  personality: z.string().default('personality.json'),
  tags: z.array(z.string()).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

// Voice configuration
export const companionVoiceSchema = z.object({
  provider: z.enum(['openai', 'elevenlabs', 'browser']).default('elevenlabs'),
  voiceId: z.string().default('MEJe6hPrI48Kt2lFuVe3'), // Yumi voice
  speed: z.number().min(0.5).max(2).default(1.0),
})

// Expression mappings
export const companionExpressionsSchema = z.object({
  default: z.string().optional(),
  onThinking: z.string().optional(),
  onHappy: z.string().optional(),
  onSad: z.string().optional(),
  onSurprised: z.string().optional(),
})

// Personality configuration (personality.json)
export const companionPersonalitySchema = z.object({
  name: z.string().min(1).max(48),
  traits: z.array(z.string()).max(12).default([]),
  systemPrompt: z.string().min(10).max(8000),
  voice: companionVoiceSchema.optional(),
  expressions: companionExpressionsSchema.optional(),
  // Extended content (examples, guidelines) - optional for custom companions
  examples: z.string().optional(),
})

// Inferred types
export type CompanionModel = z.infer<typeof companionModelSchema>
export type CompanionManifest = z.infer<typeof companionManifestSchema>
export type CompanionVoice = z.infer<typeof companionVoiceSchema>
export type CompanionExpressions = z.infer<typeof companionExpressionsSchema>
export type CompanionPersonality = z.infer<typeof companionPersonalitySchema>

// Loaded companion (fully resolved with URLs)
export interface LoadedCompanion {
  manifest: CompanionManifest
  personality: CompanionPersonality
  modelUrl: string      // Resolved URL to model entry
  previewUrl: string    // Resolved URL to preview image
  baseUrl: string       // Base URL for the companion folder
}

// Companion source type
export type CompanionSource = 'bundled' | 'installed'

// Companion metadata (for listing/display)
export interface CompanionInfo {
  id: string
  name: string
  description: string
  preview: string
  tags: string[]
  source: CompanionSource
  version: string
  author: string
}
