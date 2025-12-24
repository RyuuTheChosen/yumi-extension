/**
 * Entity Store
 *
 * Higher-level interface for entity link operations.
 * Handles Chrome message passing for content script access.
 */

import type { Memory, EntityLink, EntityType } from '../types'
import {
  extractEntitiesFromMemory,
  createEntityLinks,
  type ExtractedEntity
} from './entityExtractor'
import {
  saveEntityLink,
  getEntityLink,
  getAllEntityLinks,
  getEntitiesForMemory,
  getEntitiesByType,
  removeMemoryFromEntities
} from '../db'
import { createLogger } from '../../core/debug'

const log = createLogger('EntityStore')

/**
 * Process a memory and update entity links.
 * Extracts entities and saves/updates the corresponding links.
 */
export async function processMemoryEntities(memory: Memory): Promise<EntityLink[]> {
  try {
    const extracted = extractEntitiesFromMemory(memory)

    if (extracted.length === 0) {
      return []
    }

    const existingEntities = await getAllEntityLinks()

    const entityLinks = createEntityLinks(memory, extracted, existingEntities)

    for (const link of entityLinks) {
      await saveEntityLink(link)
    }

    log.log(`[EntityStore] Processed ${entityLinks.length} entities for memory ${memory.id}`)
    return entityLinks
  } catch (err) {
    log.error('[EntityStore] Failed to process memory entities:', err)
    return []
  }
}

/**
 * Process multiple memories for entity extraction
 */
export async function processMemoriesEntities(memories: Memory[]): Promise<number> {
  let totalProcessed = 0

  for (const memory of memories) {
    const links = await processMemoryEntities(memory)
    totalProcessed += links.length
  }

  return totalProcessed
}

/**
 * Get all entities linked to a specific memory
 */
export async function getMemoryEntities(memoryId: string): Promise<EntityLink[]> {
  return getEntitiesForMemory(memoryId)
}

/**
 * Get all entity links
 */
export async function getAllEntities(): Promise<EntityLink[]> {
  return getAllEntityLinks()
}

/**
 * Get entities by type
 */
export async function getEntitiesByEntityType(entityType: EntityType): Promise<EntityLink[]> {
  return getEntitiesByType(entityType)
}

/**
 * Clean up entity links when a memory is deleted
 */
export async function cleanupDeletedMemory(memoryId: string): Promise<number> {
  return removeMemoryFromEntities(memoryId)
}

/**
 * Clean up entity links for multiple deleted memories
 */
export async function cleanupDeletedMemories(memoryIds: string[]): Promise<number> {
  let totalUpdated = 0

  for (const memoryId of memoryIds) {
    const updated = await removeMemoryFromEntities(memoryId)
    totalUpdated += updated
  }

  return totalUpdated
}

/**
 * Re-index all memories for entities.
 * Useful for rebuilding entity links after migration or corruption.
 */
export async function reindexAllEntities(
  getAllMemoriesFn: () => Promise<Memory[]>
): Promise<{ processed: number; entities: number }> {
  const { clearAllEntityLinks } = await import('../db')

  await clearAllEntityLinks()
  log.log('[EntityStore] Cleared existing entity links for reindex')

  const memories = await getAllMemoriesFn()
  let entities = 0

  for (const memory of memories) {
    const links = await processMemoryEntities(memory)
    entities += links.length
  }

  log.log(`[EntityStore] Reindexed ${memories.length} memories, created ${entities} entity links`)

  return { processed: memories.length, entities }
}

/**
 * Get entity statistics
 */
export async function getEntityStats(): Promise<{
  total: number
  byType: Record<EntityType, number>
  topEntities: Array<{ name: string; type: EntityType; memoryCount: number }>
}> {
  const allEntities = await getAllEntityLinks()

  const byType: Record<EntityType, number> = {
    person: 0,
    project: 0,
    skill: 0,
    technology: 0
  }

  for (const entity of allEntities) {
    byType[entity.entityType]++
  }

  const topEntities = allEntities
    .sort((a, b) => b.memoryIds.length - a.memoryIds.length)
    .slice(0, 10)
    .map(e => ({
      name: e.displayName,
      type: e.entityType,
      memoryCount: e.memoryIds.length
    }))

  return {
    total: allEntities.length,
    byType,
    topEntities
  }
}

export type { ExtractedEntity }
