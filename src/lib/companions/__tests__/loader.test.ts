import { describe, it, expect } from 'vitest'
import {
  loadBundledCompanion,
  getActiveCompanion,
  companionExists,
  getDefaultCompanionId
} from '../loader'
import {
  companionManifestSchema,
  companionPersonalitySchema,
  type CompanionManifest,
  type CompanionPersonality
} from '../types'

describe('Companion Loader', () => {
  describe('companionManifestSchema validation', () => {
    it('accepts valid manifest', () => {
      const valid = {
        id: 'yumi',
        name: 'Yumi',
        version: '1.0.0',
        description: 'Default companion',
        author: 'Yumi Labs',
        preview: 'preview.png',
        personality: 'personality.json',
        model: {
          entry: 'model/yumi.model3.json',
          scale: 0.15,
          position: 'bottom-right' as const
        },
        tags: ['default']
      }

      const result = companionManifestSchema.safeParse(valid)
      expect(result.success).toBe(true)
    })

    it('rejects manifest with missing id', () => {
      const missing = {
        name: 'Test',
        model: {
          entry: 'model.json',
          scale: 0.15,
          position: 'bottom-right' as const
        }
      }

      const result = companionManifestSchema.safeParse(missing)
      expect(result.success).toBe(false)
    })

    it('rejects manifest with empty id', () => {
      const emptyId = {
        id: '',
        name: 'Test',
        model: {
          entry: 'model.json',
          scale: 0.15,
          position: 'bottom-right' as const
        }
      }

      const result = companionManifestSchema.safeParse(emptyId)
      expect(result.success).toBe(false)
    })

    it('rejects manifest with name over 48 characters', () => {
      const longName = {
        id: 'test',
        name: 'a'.repeat(49),
        model: {
          entry: 'model.json',
          scale: 0.15,
          position: 'bottom-right' as const
        }
      }

      const result = companionManifestSchema.safeParse(longName)
      expect(result.success).toBe(false)
    })

    it('rejects manifest with description over 500 characters', () => {
      const longDesc = {
        id: 'test',
        name: 'Test',
        description: 'a'.repeat(501),
        model: {
          entry: 'model.json',
          scale: 0.15,
          position: 'bottom-right' as const
        }
      }

      const result = companionManifestSchema.safeParse(longDesc)
      expect(result.success).toBe(false)
    })

    it('accepts manifest with defaults', () => {
      const minimal = {
        id: 'test',
        name: 'Test',
        model: {
          entry: 'model.json'
        }
      }

      const result = companionManifestSchema.safeParse(minimal)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.version).toBe('1.0.0')
        expect(result.data.description).toBe('')
        expect(result.data.author).toBe('Unknown')
        expect(result.data.model.scale).toBe(0.15)
        expect(result.data.model.position).toBe('bottom-right')
      }
    })

    it('rejects invalid model position', () => {
      const invalid = {
        id: 'test',
        name: 'Test',
        model: {
          entry: 'model.json',
          position: 'top-left' as any
        }
      }

      const result = companionManifestSchema.safeParse(invalid)
      expect(result.success).toBe(false)
    })
  })

  describe('companionPersonalitySchema validation', () => {
    it('accepts valid personality', () => {
      const valid = {
        name: 'Yumi',
        traits: ['friendly', 'helpful', 'curious'],
        systemPrompt: 'You are Yumi, a friendly AI assistant who helps users with their tasks.',
        voice: {
          provider: 'elevenlabs' as const,
          voiceId: 'test-voice-id',
          speed: 1.0
        },
        expressions: {
          default: 'neutral',
          onThinking: 'thinking',
          onHappy: 'happy'
        },
        capabilities: {
          plugins: ['memory', 'search', 'tts']
        }
      }

      const result = companionPersonalitySchema.safeParse(valid)
      expect(result.success).toBe(true)
    })

    it('rejects personality with missing name', () => {
      const missing = {
        traits: ['friendly'],
        systemPrompt: 'Test prompt with enough characters for validation'
      }

      const result = companionPersonalitySchema.safeParse(missing)
      expect(result.success).toBe(false)
    })

    it('rejects personality with systemPrompt under 10 chars', () => {
      const tooShort = {
        name: 'Test',
        traits: ['friendly'],
        systemPrompt: 'short'
      }

      const result = companionPersonalitySchema.safeParse(tooShort)
      expect(result.success).toBe(false)
    })

    it('rejects personality with systemPrompt over 8000 chars', () => {
      const tooLong = {
        name: 'Test',
        traits: ['friendly'],
        systemPrompt: 'a'.repeat(8001)
      }

      const result = companionPersonalitySchema.safeParse(tooLong)
      expect(result.success).toBe(false)
    })

    it('rejects personality with over 12 traits', () => {
      const tooManyTraits = {
        name: 'Test',
        traits: Array(13).fill('trait'),
        systemPrompt: 'Test prompt with enough characters'
      }

      const result = companionPersonalitySchema.safeParse(tooManyTraits)
      expect(result.success).toBe(false)
    })

    it('rejects personality with name over 48 characters', () => {
      const longName = {
        name: 'a'.repeat(49),
        traits: ['friendly'],
        systemPrompt: 'Test prompt with enough characters'
      }

      const result = companionPersonalitySchema.safeParse(longName)
      expect(result.success).toBe(false)
    })

    it('accepts minimal personality without optional fields', () => {
      const minimal = {
        name: 'Test',
        systemPrompt: 'Test prompt with enough characters for validation'
      }

      const result = companionPersonalitySchema.safeParse(minimal)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.traits).toEqual([])
      }
    })

    it('validates voice provider enum', () => {
      const invalidProvider = {
        name: 'Test',
        traits: ['friendly'],
        systemPrompt: 'Test prompt with enough characters',
        voice: {
          provider: 'invalid-provider' as any,
          voiceId: 'test'
        }
      }

      const result = companionPersonalitySchema.safeParse(invalidProvider)
      expect(result.success).toBe(false)
    })

    it('validates voice speed range', () => {
      const invalidSpeed = {
        name: 'Test',
        traits: ['friendly'],
        systemPrompt: 'Test prompt with enough characters',
        voice: {
          provider: 'elevenlabs' as const,
          voiceId: 'test',
          speed: 3.0
        }
      }

      const result = companionPersonalitySchema.safeParse(invalidSpeed)
      expect(result.success).toBe(false)
    })

    it('applies voice defaults', () => {
      const withVoice = {
        name: 'Test',
        traits: ['friendly'],
        systemPrompt: 'Test prompt with enough characters',
        voice: {
          voiceId: 'test-id'
        }
      }

      const result = companionPersonalitySchema.safeParse(withVoice)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.voice?.provider).toBe('elevenlabs')
        expect(result.data.voice?.speed).toBe(1.0)
      }
    })
  })

  describe('loadBundledCompanion', () => {
    it('loads default yumi companion', async () => {
      const companion = await loadBundledCompanion()

      expect(companion).toBeDefined()
      expect(companion.manifest.id).toBe('yumi')
      expect(companion.manifest.name).toBe('Yumi')
      expect(companion.personality.name).toBeDefined()
      expect(companion.personality.systemPrompt).toBeDefined()
      expect(companion.modelUrl).toBeDefined()
      expect(companion.previewUrl).toBeDefined()
      expect(companion.baseUrl).toBeDefined()
    })

    it('returns valid manifest structure', async () => {
      const companion = await loadBundledCompanion()

      const manifestResult = companionManifestSchema.safeParse(companion.manifest)
      expect(manifestResult.success).toBe(true)
    })

    it('returns valid personality structure', async () => {
      const companion = await loadBundledCompanion()

      const personalityResult = companionPersonalitySchema.safeParse(companion.personality)
      expect(personalityResult.success).toBe(true)
    })

    it('provides resolvable URLs', async () => {
      const companion = await loadBundledCompanion()

      expect(companion.modelUrl).toContain('model')
      expect(companion.previewUrl).toContain('preview')
      expect(companion.baseUrl).toContain('companions')
    })
  })

  describe('getDefaultCompanionId', () => {
    it('returns yumi as default', () => {
      const defaultId = getDefaultCompanionId()
      expect(defaultId).toBe('yumi')
    })
  })

  describe('companionExists', () => {
    it('returns true for bundled yumi companion', async () => {
      const exists = await companionExists('yumi')
      expect(exists).toBe(true)
    })

    it('returns false for non-existent companion', async () => {
      const exists = await companionExists('non-existent-companion-xyz')
      expect(exists).toBe(false)
    })
  })

  describe('getActiveCompanion', () => {
    it('returns companion when valid slug provided', async () => {
      const companion = await getActiveCompanion('yumi')

      expect(companion).toBeDefined()
      expect(companion.manifest.id).toBe('yumi')
    })

    it('falls back to default when no slug provided', async () => {
      const companion = await getActiveCompanion()

      expect(companion).toBeDefined()
      expect(companion.manifest).toBeDefined()
    })

    it('falls back to default when invalid slug provided', async () => {
      const companion = await getActiveCompanion('invalid-slug-xyz')

      expect(companion).toBeDefined()
      expect(companion.manifest.id).toBe('yumi')
    })
  })
})
