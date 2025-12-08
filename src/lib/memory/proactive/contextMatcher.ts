/**
 * Context Matcher for Proactive Memory
 *
 * Matches current page context to relevant memories using
 * keyword extraction and TF-IDF scoring.
 */

import type { Memory, MemoryType } from '../types'
import { extractKeywords, getMatchingKeywords, jaccardSimilarity } from '../retrieval/keywords'
import { extractSubject } from './followUp'

export interface ContextMatch {
  memory: Memory
  relevance: number // 0-1
  matchType: 'keyword' | 'domain' | 'page_type'
  explanation: string
}

export interface PageContext {
  url: string
  origin: string
  title: string
  mainContent?: string
  pageType?: 'code' | 'article' | 'social' | 'shopping' | 'video' | 'other'
}

// Page type to memory type associations
const PAGE_TYPE_MATCHES: Record<string, MemoryType[]> = {
  code: ['project', 'skill'],
  article: ['skill', 'opinion'],
  social: ['person'],
  shopping: ['preference'],
  video: ['preference', 'skill'],
}

/**
 * Find memories that match the current page context
 */
export function findContextMatches(
  context: PageContext,
  memories: Memory[],
  cooldowns: Map<string, number>,
  limit: number = 3
): ContextMatch[] {
  const now = Date.now()
  const matches: ContextMatch[] = []

  // Extract keywords from page content
  const pageText = `${context.title} ${context.mainContent || ''}`.toLowerCase()
  const pageKeywords = extractKeywords(pageText)

  for (const memory of memories) {
    if (memory.type === 'identity') continue
    if (memory.importance < 0.4) continue
    if (memory.confidence < 0.5) continue
    if (isOnCooldown(memory.id, cooldowns, now)) continue

    let bestMatch: ContextMatch | null = null

    if (memory.source?.url) {
      try {
        const memoryOrigin = new URL(memory.source.url).origin
        if (memoryOrigin === context.origin) {
          const importanceBoost = memory.importance * 0.2
          bestMatch = {
            memory,
            relevance: 0.6 + importanceBoost,
            matchType: 'domain',
            explanation: `you mentioned "${extractSubject(memory.content)}" here before`,
          }
        }
      } catch {
      }
    }

    if (!bestMatch && context.pageType) {
      const matchingTypes = PAGE_TYPE_MATCHES[context.pageType]
      if (matchingTypes?.includes(memory.type)) {
        bestMatch = {
          memory,
          relevance: 0.5,
          matchType: 'page_type',
          explanation: `this might relate to ${extractSubject(memory.content)}`,
        }
      }
    }

    const memoryKeywords = extractKeywords(memory.content + ' ' + (memory.context || ''))
    const matchedKeywords = getMatchingKeywords(pageKeywords, memoryKeywords)

    if (matchedKeywords.length >= 2) {
      const similarity = jaccardSimilarity(pageKeywords, memoryKeywords)
      const matchBoost = Math.min(matchedKeywords.length * 0.12, 0.4)
      const accessBoost = Math.min(memory.accessCount * 0.03, 0.15)
      const relevance = Math.min(similarity + matchBoost + accessBoost, 1.0)

      if (relevance > 0.4) {
        const keywordsDisplay = matchedKeywords.slice(0, 2).join(', ')
        bestMatch = {
          memory,
          relevance,
          matchType: 'keyword',
          explanation: `page mentions ${keywordsDisplay}`,
        }
      }
    }

    if (bestMatch && !matches.some((m) => m.memory.id === memory.id)) {
      matches.push(bestMatch)
    }
  }

  // Sort by relevance and return top matches
  return matches.sort((a, b) => b.relevance - a.relevance).slice(0, limit)
}

/**
 * Detect page type from URL and content
 */
export function detectPageType(
  url: string,
  title: string
): 'code' | 'article' | 'social' | 'shopping' | 'video' | 'other' {
  const urlLower = url.toLowerCase()
  const titleLower = title.toLowerCase()

  // Code/development sites
  if (
    urlLower.includes('github.com') ||
    urlLower.includes('gitlab.com') ||
    urlLower.includes('bitbucket.org') ||
    urlLower.includes('stackoverflow.com') ||
    urlLower.includes('dev.to') ||
    urlLower.includes('npmjs.com') ||
    urlLower.includes('crates.io') ||
    urlLower.includes('pypi.org')
  ) {
    return 'code'
  }

  // Video platforms
  if (
    urlLower.includes('youtube.com') ||
    urlLower.includes('vimeo.com') ||
    urlLower.includes('twitch.tv') ||
    urlLower.includes('netflix.com')
  ) {
    return 'video'
  }

  // Social media
  if (
    urlLower.includes('twitter.com') ||
    urlLower.includes('x.com') ||
    urlLower.includes('facebook.com') ||
    urlLower.includes('instagram.com') ||
    urlLower.includes('linkedin.com') ||
    urlLower.includes('reddit.com') ||
    urlLower.includes('discord.com')
  ) {
    return 'social'
  }

  // Shopping
  if (
    urlLower.includes('amazon.com') ||
    urlLower.includes('ebay.com') ||
    urlLower.includes('etsy.com') ||
    urlLower.includes('shop') ||
    urlLower.includes('store') ||
    titleLower.includes('buy') ||
    titleLower.includes('cart')
  ) {
    return 'shopping'
  }

  // Article detection (news, blogs, etc.)
  if (
    urlLower.includes('medium.com') ||
    urlLower.includes('substack.com') ||
    urlLower.includes('/blog') ||
    urlLower.includes('/article') ||
    urlLower.includes('/news') ||
    urlLower.includes('/post')
  ) {
    return 'article'
  }

  return 'other'
}

/**
 * Check if a memory is on cooldown
 */
function isOnCooldown(memoryId: string, cooldowns: Map<string, number>, now: number): boolean {
  const expiresAt = cooldowns.get(memoryId)
  return expiresAt !== undefined && now < expiresAt
}
