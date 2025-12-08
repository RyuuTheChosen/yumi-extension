import { describe, it, expect } from 'vitest'
import { parseExtractionResponse, filterSensitiveMemories, containsSensitiveContent } from '..'

describe('Memory Extraction', () => {
  describe('parseExtractionResponse', () => {
    it('returns empty array for malformed JSON', () => {
      expect(parseExtractionResponse('not json')).toEqual([])
      expect(parseExtractionResponse('{"incomplete":')).toEqual([])
      expect(parseExtractionResponse('')).toEqual([])
    })

    it('returns empty array for non-array JSON', () => {
      expect(parseExtractionResponse('{}')).toEqual([])
      expect(parseExtractionResponse('"string"')).toEqual([])
      expect(parseExtractionResponse('123')).toEqual([])
    })

    it('skips memories with invalid type', () => {
      const invalidType = JSON.stringify([
        { content: 'test', type: 'invalid_type', importance: 0.8, confidence: 0.9 }
      ])
      const result = parseExtractionResponse(invalidType)
      expect(result).toEqual([])
    })

    it('accepts valid memory types', () => {
      const validTypes = ['identity', 'preference', 'skill', 'project', 'person', 'event', 'opinion']

      for (const type of validTypes) {
        const json = JSON.stringify([
          { content: 'test content', type, importance: 0.8, confidence: 0.9 }
        ])
        const result = parseExtractionResponse(json)
        expect(result.length).toBeGreaterThan(0)
        expect(result[0].type).toBe(type)
      }
    })

    it('skips memories missing required fields', () => {
      const missingContent = JSON.stringify([
        { type: 'skill', importance: 0.8, confidence: 0.9 }
      ])
      expect(parseExtractionResponse(missingContent)).toEqual([])

      const missingType = JSON.stringify([
        { content: 'test', importance: 0.8, confidence: 0.9 }
      ])
      expect(parseExtractionResponse(missingType)).toEqual([])
    })

    it('clamps invalid ranges to valid values', () => {
      const highImportance = JSON.stringify([
        { content: 'test', type: 'skill', importance: 1.5, confidence: 0.9 }
      ])
      const result1 = parseExtractionResponse(highImportance)
      expect(result1.length).toBeGreaterThan(0)
      expect(result1[0].importance).toBe(1) // Clamped to max

      const negativeImportance = JSON.stringify([
        { content: 'test', type: 'skill', importance: -0.5, confidence: 0.9 }
      ])
      const result2 = parseExtractionResponse(negativeImportance)
      expect(result2.length).toBeGreaterThan(0)
      expect(result2[0].importance).toBe(0) // Clamped to min
    })

    it('skips content over 500 characters', () => {
      const tooLong = 'a'.repeat(501)
      const json = JSON.stringify([
        { content: tooLong, type: 'skill', importance: 0.8, confidence: 0.9 }
      ])
      expect(parseExtractionResponse(json)).toEqual([])
    })

    it('parses valid memory array', () => {
      const valid = JSON.stringify([
        { content: 'loves pizza', type: 'preference', importance: 0.7, confidence: 0.9 },
        { content: 'works at Acme', type: 'person', importance: 0.8, confidence: 0.95 }
      ])
      const result = parseExtractionResponse(valid)
      expect(result).toHaveLength(2)
      expect(result[0].content).toBe('loves pizza')
      expect(result[1].type).toBe('person')
    })

    it('extracts JSON array from text with surrounding content', () => {
      const responseWithText = `Here are the memories:
      [
        { "content": "loves pizza", "type": "preference", "importance": 0.7, "confidence": 0.9 }
      ]
      That's all I found.`
      const result = parseExtractionResponse(responseWithText)
      expect(result).toHaveLength(1)
      expect(result[0].content).toBe('loves pizza')
    })
  })

  describe('containsSensitiveContent', () => {
    it('detects password patterns', () => {
      expect(containsSensitiveContent('my password is secret123')).toBe(true)
      expect(containsSensitiveContent('Password: abc123')).toBe(true)
    })

    it('detects API key patterns', () => {
      expect(containsSensitiveContent('my apiKey value here')).toBe(true)
      expect(containsSensitiveContent('API-KEY value')).toBe(true)
      expect(containsSensitiveContent('apikey configuration')).toBe(true)
    })

    it('detects secret patterns', () => {
      expect(containsSensitiveContent('client secret: xyz789')).toBe(true)
      expect(containsSensitiveContent('SECRET_VALUE here')).toBe(true)
    })

    it('detects token patterns', () => {
      expect(containsSensitiveContent('access token: bearer xyz')).toBe(true)
      expect(containsSensitiveContent('TOKEN value')).toBe(true)
    })

    it('detects credential patterns', () => {
      expect(containsSensitiveContent('user credentials stored')).toBe(true)
      expect(containsSensitiveContent('CREDENTIAL file')).toBe(true)
    })

    it('detects credit card patterns', () => {
      expect(containsSensitiveContent('4532-1234-5678-9010')).toBe(true)
      expect(containsSensitiveContent('4532 1234 5678 9010')).toBe(true)
      expect(containsSensitiveContent('4532123456789010')).toBe(true)
    })

    it('allows safe content', () => {
      expect(containsSensitiveContent('loves pizza')).toBe(false)
      expect(containsSensitiveContent('skilled in JavaScript')).toBe(false)
      expect(containsSensitiveContent('working on project X')).toBe(false)
    })
  })

  describe('filterSensitiveMemories', () => {
    it('filters memories with sensitive content', () => {
      const memories = [
        { content: 'my password is abc123', type: 'identity' as const, importance: 0.8, confidence: 0.9 },
        { content: 'bearer token value', type: 'identity' as const, importance: 0.8, confidence: 0.9 },
        { content: 'loves pizza', type: 'preference' as const, importance: 0.8, confidence: 0.9 }
      ]

      const filtered = filterSensitiveMemories(memories)
      expect(filtered).toHaveLength(1)
      expect(filtered[0].content).toBe('loves pizza')
    })

    it('filters memories with sensitive context', () => {
      const memories = [
        { content: 'discussed auth', type: 'event' as const, importance: 0.8, confidence: 0.9, context: 'secret token xyz' },
        { content: 'meeting notes', type: 'event' as const, importance: 0.8, confidence: 0.9, context: 'safe context' }
      ]

      const filtered = filterSensitiveMemories(memories)
      expect(filtered).toHaveLength(1)
      expect(filtered[0].content).toBe('meeting notes')
    })

    it('preserves all memories when none are sensitive', () => {
      const memories = [
        { content: 'loves pizza', type: 'preference' as const, importance: 0.8, confidence: 0.9 },
        { content: 'skilled in TypeScript', type: 'skill' as const, importance: 0.8, confidence: 0.9 },
        { content: 'working at Acme Corp', type: 'person' as const, importance: 0.8, confidence: 0.9 }
      ]

      const filtered = filterSensitiveMemories(memories)
      expect(filtered).toHaveLength(3)
    })
  })
})
