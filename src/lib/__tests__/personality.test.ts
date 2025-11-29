import { describe, it, expect } from 'vitest'
import { assembleSystemPrompt, createPersonality } from '../../lib/personality'

describe('personality', () => {
  it('creates valid personality', () => {
    const p = createPersonality({ name: 'Nova', systemPrompt: 'Be concise and helpful.' })
    expect(p.name).toBe('Nova')
    expect(p.systemPrompt).toContain('concise')
    expect(typeof p.id).toBe('string')
  })

  it('assembles prompt with traits', () => {
    const p = createPersonality({
      name: 'Techie',
      systemPrompt: 'Answer like a senior engineer.',
      traits: ['technical', 'concise'],
    })
    const prompt = assembleSystemPrompt(p)
    expect(prompt).toMatch(/Communication Traits/)
    expect(prompt).toMatch(/technical/i)
    expect(prompt).toMatch(/senior engineer/)
  })

  it('requires minimum prompt length', () => {
    expect(() => createPersonality({ name: 'Err', systemPrompt: 'short' })).toThrow()
  })

  it('normalizes and deduplicates traits', () => {
    const p = createPersonality({
      name: 'Traits',
      systemPrompt: 'Long enough prompt',
      traits: [' Friendly ', 'friendly', 'TECHNICAL', 'technical', 'Concise '],
    })
    expect(p.traits).toEqual(['friendly', 'technical', 'concise'])
  })
})
