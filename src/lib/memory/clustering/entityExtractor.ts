/**
 * Entity Extractor
 *
 * Extracts entities (people, projects, skills, technologies) from memory content.
 * Uses pattern matching and memory type hints to identify entities.
 */

import type { Memory, EntityType, EntityLink } from '../types'
import { CLUSTERING_CONFIG } from '../types'
import { createLogger } from '../../core/debug'

const log = createLogger('EntityExtractor')

/**
 * Extracted entity before being saved to DB
 */
export interface ExtractedEntity {
  entityType: EntityType
  entityName: string
  displayName: string
}

/**
 * Technology and skill patterns for extraction
 */
const TECHNOLOGY_PATTERNS = [
  /\b(react|vue|angular|svelte|next\.?js|nuxt|gatsby|remix)\b/gi,
  /\b(typescript|javascript|python|rust|go|java|c\+\+|c#|ruby|php|swift|kotlin)\b/gi,
  /\b(node\.?js|deno|bun|express|fastify|nest\.?js|django|flask|rails|spring)\b/gi,
  /\b(mongodb|postgres|mysql|redis|elasticsearch|dynamodb|supabase|firebase)\b/gi,
  /\b(aws|gcp|azure|vercel|netlify|cloudflare|docker|kubernetes|k8s)\b/gi,
  /\b(graphql|rest|grpc|websocket|webrtc)\b/gi,
  /\b(tailwind|sass|less|styled-components|emotion|css-in-js)\b/gi,
  /\b(webpack|vite|rollup|esbuild|turbopack|parcel)\b/gi,
  /\b(jest|vitest|cypress|playwright|mocha|pytest)\b/gi,
  /\b(git|github|gitlab|bitbucket|jira|confluence|notion)\b/gi,
  /\b(figma|sketch|adobe xd|photoshop|illustrator)\b/gi,
  /\b(openai|anthropic|claude|gpt|llm|langchain|llamaindex)\b/gi,
  /\b(tensorflow|pytorch|keras|scikit-learn|pandas|numpy)\b/gi,
  /\b(linux|ubuntu|macos|windows|ios|android)\b/gi,
  /\b(vim|neovim|emacs|vscode|intellij|webstorm)\b/gi,
]

/**
 * Skill patterns (more abstract than technologies)
 */
const SKILL_PATTERNS = [
  /\b(frontend|backend|fullstack|full-stack|devops|sre|data science|machine learning|ml|ai)\b/gi,
  /\b(web development|mobile development|game development|embedded|systems programming)\b/gi,
  /\b(ux design|ui design|product design|graphic design)\b/gi,
  /\b(project management|agile|scrum|kanban)\b/gi,
  /\b(teaching|mentoring|technical writing|public speaking)\b/gi,
  /\b(security|penetration testing|cryptography)\b/gi,
  /\b(database design|api design|system design|architecture)\b/gi,
]

/**
 * Project indicator patterns
 */
const PROJECT_INDICATORS = [
  /working on\s+(?:a\s+)?([^,.]+(?:app|project|tool|website|platform|service|api|extension|plugin|library|framework))/gi,
  /building\s+(?:a\s+)?([^,.]+(?:app|project|tool|website|platform|service|api|extension|plugin|library|framework))/gi,
  /developing\s+(?:a\s+)?([^,.]+)/gi,
  /my\s+([^,.]+(?:project|app|startup|company|side project))/gi,
  /called\s+"?([^",.]+)"?/gi,
  /named\s+"?([^",.]+)"?/gi,
]

/**
 * Person name patterns (simple heuristics)
 */
const PERSON_PATTERNS = [
  /(?:my\s+)?(?:friend|colleague|coworker|boss|manager|mentor|partner|wife|husband|girlfriend|boyfriend|brother|sister|mom|dad|mother|father)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
  /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:is my|is a|works|lives|helps|teaches|mentors)/g,
  /working with\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
  /(?:met|know|talked to|spoke with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
]

/**
 * Normalize entity name for consistent matching
 */
function normalizeEntityName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s.-]/g, '')
}

/**
 * Generate a stable entity ID from type and normalized name
 */
function generateEntityId(entityType: EntityType, normalizedName: string): string {
  const combined = `${entityType}:${normalizedName}`
  let hash = 0
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return `entity-${entityType}-${Math.abs(hash).toString(36)}`
}

/**
 * Extract technologies from text
 */
function extractTechnologies(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = []
  const seen = new Set<string>()

  for (const pattern of TECHNOLOGY_PATTERNS) {
    let match
    const regex = new RegExp(pattern.source, pattern.flags)

    while ((match = regex.exec(text)) !== null) {
      const displayName = match[1] || match[0]
      const normalized = normalizeEntityName(displayName)

      if (normalized.length >= CLUSTERING_CONFIG.minEntityLength && !seen.has(normalized)) {
        seen.add(normalized)
        entities.push({
          entityType: 'technology',
          entityName: normalized,
          displayName: displayName.trim()
        })
      }
    }
  }

  return entities
}

/**
 * Extract skills from text
 */
function extractSkills(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = []
  const seen = new Set<string>()

  for (const pattern of SKILL_PATTERNS) {
    let match
    const regex = new RegExp(pattern.source, pattern.flags)

    while ((match = regex.exec(text)) !== null) {
      const displayName = match[1] || match[0]
      const normalized = normalizeEntityName(displayName)

      if (normalized.length >= CLUSTERING_CONFIG.minEntityLength && !seen.has(normalized)) {
        seen.add(normalized)
        entities.push({
          entityType: 'skill',
          entityName: normalized,
          displayName: displayName.trim()
        })
      }
    }
  }

  return entities
}

/**
 * Extract project names from text
 */
function extractProjects(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = []
  const seen = new Set<string>()

  for (const pattern of PROJECT_INDICATORS) {
    let match
    const regex = new RegExp(pattern.source, pattern.flags)

    while ((match = regex.exec(text)) !== null) {
      const displayName = match[1]
      if (!displayName) continue

      const normalized = normalizeEntityName(displayName)

      if (
        normalized.length >= CLUSTERING_CONFIG.minEntityLength &&
        normalized.length <= 50 &&
        !seen.has(normalized)
      ) {
        seen.add(normalized)
        entities.push({
          entityType: 'project',
          entityName: normalized,
          displayName: displayName.trim()
        })
      }
    }
  }

  return entities
}

/**
 * Extract person names from text
 */
function extractPeople(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = []
  const seen = new Set<string>()

  for (const pattern of PERSON_PATTERNS) {
    let match
    const regex = new RegExp(pattern.source, pattern.flags)

    while ((match = regex.exec(text)) !== null) {
      const displayName = match[1]
      if (!displayName) continue

      const normalized = normalizeEntityName(displayName)

      if (
        normalized.length >= CLUSTERING_CONFIG.minEntityLength &&
        normalized.length <= 50 &&
        !seen.has(normalized) &&
        !isCommonWord(normalized)
      ) {
        seen.add(normalized)
        entities.push({
          entityType: 'person',
          entityName: normalized,
          displayName: displayName.trim()
        })
      }
    }
  }

  return entities
}

/**
 * Check if a word is too common to be a person name
 */
function isCommonWord(word: string): boolean {
  const commonWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
    'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can',
    'that', 'this', 'these', 'those', 'what', 'which', 'who', 'whom',
    'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'she',
    'it', 'they', 'them', 'their', 'user', 'person', 'people', 'someone'
  ])
  return commonWords.has(word.toLowerCase())
}

/**
 * Extract entities from a memory based on content and type
 */
export function extractEntitiesFromMemory(memory: Memory): ExtractedEntity[] {
  const text = `${memory.content} ${memory.context || ''}`
  const entities: ExtractedEntity[] = []

  /** Extract based on memory type */
  switch (memory.type) {
    case 'skill':
      entities.push(...extractSkills(text))
      entities.push(...extractTechnologies(text))
      break

    case 'project':
      entities.push(...extractProjects(text))
      entities.push(...extractTechnologies(text))
      break

    case 'person':
      entities.push(...extractPeople(text))
      break

    default:
      /** For other types, try all extractors */
      entities.push(...extractTechnologies(text))
      entities.push(...extractSkills(text))
      entities.push(...extractPeople(text))
      entities.push(...extractProjects(text))
  }

  /** Also extract technologies from any memory (cross-cutting concern) */
  if (memory.type !== 'skill' && memory.type !== 'project') {
    entities.push(...extractTechnologies(text))
  }

  /** Deduplicate by normalized name + type */
  const seen = new Set<string>()
  const deduped = entities.filter(entity => {
    const key = `${entity.entityType}:${entity.entityName}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  /** Limit to max entities */
  const limited = deduped.slice(0, CLUSTERING_CONFIG.maxEntitiesPerMemory)

  if (limited.length > 0) {
    log.log(`[EntityExtractor] Extracted ${limited.length} entities from memory: ${memory.content.slice(0, 40)}...`)
  }

  return limited
}

/**
 * Create or update entity links for a memory
 */
export function createEntityLinks(
  memory: Memory,
  extractedEntities: ExtractedEntity[],
  existingEntities: EntityLink[]
): EntityLink[] {
  const now = Date.now()
  const updatedEntities: EntityLink[] = []

  for (const extracted of extractedEntities) {
    const entityId = generateEntityId(extracted.entityType, extracted.entityName)

    const existing = existingEntities.find(e => e.entityId === entityId)

    if (existing) {
      /** Update existing entity if memory not already linked */
      if (!existing.memoryIds.includes(memory.id)) {
        updatedEntities.push({
          ...existing,
          memoryIds: [...existing.memoryIds, memory.id],
          updatedAt: now
        })
      }
    } else {
      /** Create new entity link */
      updatedEntities.push({
        entityId,
        entityType: extracted.entityType,
        entityName: extracted.entityName,
        displayName: extracted.displayName,
        memoryIds: [memory.id],
        createdAt: now,
        updatedAt: now
      })
    }
  }

  return updatedEntities
}

export { generateEntityId, normalizeEntityName }
