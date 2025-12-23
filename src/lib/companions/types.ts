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

/** Model type: live2d (.model3.json) or vrm (.vrm) */
export type CompanionModelType = 'live2d' | 'vrm'

/** Model configuration */
export const companionModelSchema = z.object({
  entry: z.string(),
  type: z.enum(['live2d', 'vrm']).default('live2d'),
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

// Companion capabilities configuration
export const companionCapabilitiesSchema = z.object({
  plugins: z.array(z.string()).default([]),
})

/** Single animation definition */
export const animationDefinitionSchema = z.object({
  /** Unique identifier for this animation */
  id: z.string().min(1),
  /** Path to FBX file (relative to animations folder) */
  path: z.string().min(1),
  /** Whether animation loops (default: false) */
  loop: z.boolean().default(false),
  /** Number of times to loop (-1 = infinite, only used if loop=true) */
  loopCount: z.number().optional(),
  /** Playback speed multiplier (default: 1.0) */
  speed: z.number().min(0.1).max(3.0).default(1.0),
  /** Fade in duration in seconds (default: 0.3) */
  fadeIn: z.number().min(0).max(2.0).default(0.3),
  /** Fade out duration in seconds (default: 0.3) */
  fadeOut: z.number().min(0).max(2.0).default(0.3),
  /** Expression to apply during animation (optional) */
  expressionHint: z.string().optional(),
  /** Expression intensity 0-1 (default: 1.0) */
  expressionIntensity: z.number().min(0).max(1).default(1.0),
  /** Priority for blending (higher = more priority, default: 0) */
  priority: z.number().default(0),
  /** Tags for categorization */
  tags: z.array(z.string()).default([]),
})

/** Animation event trigger types */
export const animationTriggerTypeSchema = z.enum([
  'onIdle',
  'onIdleTimeout',
  'onTalking',
  'onThinking',
  'onGreeting',
  'onHappy',
  'onSad',
  'onSurprised',
  'onAngry',
  'onConfused',
  'onAcknowledge',
  'onDismiss',
  'onTouch',
  'onWave',
  'custom',
])

/** Event-to-animation mapping */
export const animationTriggerMappingSchema = z.object({
  /** The event trigger */
  trigger: animationTriggerTypeSchema,
  /** Animation IDs to choose from (random selection if multiple) */
  animations: z.array(z.string()).min(1),
  /** Weight for random selection (default: 1) */
  weight: z.number().min(0).default(1),
  /** Minimum time between triggers in seconds (default: 0) */
  cooldown: z.number().min(0).default(0),
  /** Custom event name (only used when trigger='custom') */
  customEvent: z.string().optional(),
})

/** Complete animations configuration */
export const companionAnimationsSchema = z.object({
  /** Version of animations schema */
  version: z.string().default('1.0.0'),
  /** Whether to use shared library animations as fallback (default: true) */
  useSharedLibrary: z.boolean().default(true),
  /** Animation definitions */
  animations: z.array(animationDefinitionSchema).default([]),
  /** Event-to-animation trigger mappings */
  triggers: z.array(animationTriggerMappingSchema).default([]),
  /** Idle timeout in seconds before playing idle animations (default: 30) */
  idleTimeout: z.number().min(5).max(300).default(30),
  /** Default blend weight for animations (default: 1.0) */
  defaultWeight: z.number().min(0).max(1).default(1.0),
})

// Personality configuration (personality.json)
export const companionPersonalitySchema = z.object({
  name: z.string().min(1).max(48),
  traits: z.array(z.string()).max(12).default([]),
  systemPrompt: z.string().min(10).max(8000),
  voice: companionVoiceSchema.optional(),
  expressions: companionExpressionsSchema.optional(),
  capabilities: companionCapabilitiesSchema.optional(),
  // Extended content (examples, guidelines) - optional for custom companions
  examples: z.string().optional(),
})

// Inferred types
export type CompanionModel = z.infer<typeof companionModelSchema>
export type CompanionManifest = z.infer<typeof companionManifestSchema>
export type CompanionVoice = z.infer<typeof companionVoiceSchema>
export type CompanionExpressions = z.infer<typeof companionExpressionsSchema>
export type CompanionCapabilities = z.infer<typeof companionCapabilitiesSchema>
export type CompanionPersonality = z.infer<typeof companionPersonalitySchema>
export type AnimationDefinition = z.infer<typeof animationDefinitionSchema>
export type AnimationTriggerType = z.infer<typeof animationTriggerTypeSchema>
export type AnimationTriggerMapping = z.infer<typeof animationTriggerMappingSchema>
export type CompanionAnimations = z.infer<typeof companionAnimationsSchema>

// Loaded companion (fully resolved with URLs)
export interface LoadedCompanion {
  manifest: CompanionManifest
  personality: CompanionPersonality
  modelUrl: string
  previewUrl: string
  baseUrl: string
  /** Animation configuration (optional - loaded from animations/animations.json) */
  animations?: CompanionAnimations
  /** Base URL for companion-specific animations folder */
  animationsBaseUrl?: string
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
