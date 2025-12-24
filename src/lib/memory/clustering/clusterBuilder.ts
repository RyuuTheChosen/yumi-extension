/**
 * Cluster Builder
 *
 * Finds related memories by analyzing shared entities.
 * Provides clustering and relationship discovery.
 */

import type { Memory, EntityLink, EntityType } from '../types'
import { CLUSTERING_CONFIG } from '../types'
import { getEntitiesForMemory, getMemoriesByIds } from '../db'
import { createLogger } from '../../core/debug'

const log = createLogger('ClusterBuilder')

/**
 * Related memory with relevance score and shared entities
 */
export interface RelatedMemory {
  memory: Memory
  relevanceScore: number
  sharedEntities: Array<{
    entityId: string
    entityType: EntityType
    entityName: string
    displayName: string
  }>
}

/**
 * Memory cluster grouped by a central entity
 */
export interface MemoryCluster {
  entity: EntityLink
  memories: Memory[]
  totalScore: number
}

/**
 * Find memories related to a given memory through shared entities
 */
export async function findRelatedMemories(
  memoryId: string,
  allMemoriesFn: () => Promise<Memory[]>,
  limit: number = CLUSTERING_CONFIG.maxRelatedMemories
): Promise<RelatedMemory[]> {
  try {
    const entities = await getEntitiesForMemory(memoryId)

    if (entities.length === 0) {
      return []
    }

    /** Collect all memory IDs that share entities with this memory */
    const relatedMemoryScores = new Map<string, {
      score: number
      entities: EntityLink[]
    }>()

    for (const entity of entities) {
      for (const relatedId of entity.memoryIds) {
        if (relatedId === memoryId) continue

        const existing = relatedMemoryScores.get(relatedId)
        if (existing) {
          existing.score += getEntityWeight(entity.entityType)
          existing.entities.push(entity)
        } else {
          relatedMemoryScores.set(relatedId, {
            score: getEntityWeight(entity.entityType),
            entities: [entity]
          })
        }
      }
    }

    if (relatedMemoryScores.size === 0) {
      return []
    }

    /** Sort by score and take top N */
    const sortedIds = Array.from(relatedMemoryScores.entries())
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit)
      .map(([id]) => id)

    /** Fetch the actual memory objects */
    const memories = await getMemoriesByIds(sortedIds)
    const memoryMap = new Map(memories.map(m => [m.id, m]))

    /** Build the result with shared entity info */
    const results: RelatedMemory[] = []

    for (const [id, data] of relatedMemoryScores) {
      const memory = memoryMap.get(id)
      if (!memory) continue

      results.push({
        memory,
        relevanceScore: data.score,
        sharedEntities: data.entities.map(e => ({
          entityId: e.entityId,
          entityType: e.entityType,
          entityName: e.entityName,
          displayName: e.displayName
        }))
      })
    }

    /** Sort by relevance and limit */
    const limited = results
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit)

    log.log(`[ClusterBuilder] Found ${limited.length} related memories for ${memoryId}`)

    return limited
  } catch (err) {
    log.error('[ClusterBuilder] Failed to find related memories:', err)
    return []
  }
}

/**
 * Get weight for entity type (affects relevance scoring)
 */
function getEntityWeight(entityType: EntityType): number {
  switch (entityType) {
    case 'person':
      return 1.5
    case 'project':
      return 1.3
    case 'skill':
      return 1.0
    case 'technology':
      return 0.8
    default:
      return 1.0
  }
}

/**
 * Build memory clusters around entities
 */
export async function buildMemoryClusters(
  entities: EntityLink[],
  allMemoriesFn: () => Promise<Memory[]>
): Promise<MemoryCluster[]> {
  const allMemories = await allMemoriesFn()
  const memoryMap = new Map(allMemories.map(m => [m.id, m]))

  const clusters: MemoryCluster[] = []

  for (const entity of entities) {
    if (entity.memoryIds.length < CLUSTERING_CONFIG.minRelatedMemories) {
      continue
    }

    const memories = entity.memoryIds
      .map(id => memoryMap.get(id))
      .filter((m): m is Memory => m !== undefined)

    if (memories.length >= CLUSTERING_CONFIG.minRelatedMemories) {
      const totalScore = memories.reduce((sum, m) => sum + m.importance, 0)

      clusters.push({
        entity,
        memories,
        totalScore
      })
    }
  }

  /** Sort clusters by total memory importance */
  return clusters.sort((a, b) => b.totalScore - a.totalScore)
}

/**
 * Get memory IDs that share entities with a set of memory IDs
 */
export async function findRelatedMemoryIds(
  memoryIds: string[],
  limit: number = 20
): Promise<string[]> {
  const relatedScores = new Map<string, number>()

  for (const memoryId of memoryIds) {
    const entities = await getEntitiesForMemory(memoryId)

    for (const entity of entities) {
      for (const relatedId of entity.memoryIds) {
        if (memoryIds.includes(relatedId)) continue

        const current = relatedScores.get(relatedId) || 0
        relatedScores.set(relatedId, current + getEntityWeight(entity.entityType))
      }
    }
  }

  return Array.from(relatedScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id)
}

/**
 * Calculate similarity score between two memories based on shared entities
 */
export async function calculateMemorySimilarity(
  memoryId1: string,
  memoryId2: string
): Promise<number> {
  const [entities1, entities2] = await Promise.all([
    getEntitiesForMemory(memoryId1),
    getEntitiesForMemory(memoryId2)
  ])

  if (entities1.length === 0 || entities2.length === 0) {
    return 0
  }

  const entityIds1 = new Set(entities1.map(e => e.entityId))
  const entityIds2 = new Set(entities2.map(e => e.entityId))

  let sharedWeight = 0

  for (const entity of entities1) {
    if (entityIds2.has(entity.entityId)) {
      sharedWeight += getEntityWeight(entity.entityType)
    }
  }

  /** Normalize by the smaller set size */
  const minSize = Math.min(entities1.length, entities2.length)
  return sharedWeight / minSize
}
