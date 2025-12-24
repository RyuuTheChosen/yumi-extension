/**
 * Memory Clustering Module
 *
 * Provides entity extraction and memory clustering capabilities.
 * Groups memories by shared entities (people, projects, skills, technologies).
 */

export {
  extractEntitiesFromMemory,
  createEntityLinks,
  generateEntityId,
  normalizeEntityName,
  type ExtractedEntity
} from './entityExtractor'

export {
  processMemoryEntities,
  processMemoriesEntities,
  getMemoryEntities,
  getAllEntities,
  getEntitiesByEntityType,
  cleanupDeletedMemory,
  cleanupDeletedMemories,
  reindexAllEntities,
  getEntityStats
} from './entityStore'

export {
  findRelatedMemories,
  buildMemoryClusters,
  findRelatedMemoryIds,
  calculateMemorySimilarity,
  type RelatedMemory,
  type MemoryCluster
} from './clusterBuilder'
