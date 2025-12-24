/**
 * Related Memories Component
 *
 * Displays memories related to a given memory through shared entities.
 */

import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link2, Users, Briefcase, Code, Cpu, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/design/utils'
import type { Memory, EntityType } from '../../lib/memory'
import type { RelatedMemory } from '../../lib/memory/clustering'

const ENTITY_TYPE_ICONS: Record<EntityType, React.ReactNode> = {
  person: <Users size={10} />,
  project: <Briefcase size={10} />,
  skill: <Code size={10} />,
  technology: <Cpu size={10} />,
}

const ENTITY_TYPE_COLORS: Record<EntityType, string> = {
  person: 'bg-pink-500/20 text-pink-300',
  project: 'bg-yellow-500/20 text-yellow-300',
  skill: 'bg-green-500/20 text-green-300',
  technology: 'bg-blue-500/20 text-blue-300',
}

export interface RelatedMemoriesProps {
  memoryId: string
  onSelectMemory?: (memory: Memory) => void
  className?: string
}

export function RelatedMemories({
  memoryId,
  onSelectMemory,
  className
}: RelatedMemoriesProps) {
  const [relatedMemories, setRelatedMemories] = useState<RelatedMemory[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadRelatedMemories() {
      setIsLoading(true)
      setError(null)

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'ENTITY_GET_RELATED_MEMORIES',
          payload: { memoryId, limit: 5 }
        })

        if (response.success) {
          setRelatedMemories(response.relatedMemories || [])
        } else {
          setError(response.error || 'Failed to load related memories')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setIsLoading(false)
      }
    }

    loadRelatedMemories()
  }, [memoryId])

  if (isLoading) {
    return (
      <div className={cn("p-3 rounded-lg bg-white/5 border border-white/10", className)}>
        <div className="flex items-center gap-1.5 text-white/40 mb-2">
          <Link2 size={12} />
          <span className="text-[10px]">Related Memories</span>
        </div>
        <div className="flex items-center justify-center py-4">
          <div className="w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  if (error) {
    return null
  }

  if (relatedMemories.length === 0) {
    return null
  }

  return (
    <div className={cn("p-3 rounded-lg bg-white/5 border border-white/10", className)}>
      <div className="flex items-center gap-1.5 text-white/40 mb-3">
        <Link2 size={12} />
        <span className="text-[10px]">Related Memories ({relatedMemories.length})</span>
      </div>

      <div className="space-y-2">
        <AnimatePresence>
          {relatedMemories.map((related, index) => (
            <motion.div
              key={related.memory.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ delay: index * 0.05 }}
              className={cn(
                "group p-2 rounded-lg bg-white/5 border border-white/10",
                "hover:bg-white/10 hover:border-white/20 transition-colors cursor-pointer"
              )}
              onClick={() => onSelectMemory?.(related.memory)}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs text-white/80 line-clamp-2 flex-1">
                  {related.memory.content}
                </p>
                <ChevronRight
                  size={14}
                  className="text-white/30 group-hover:text-white/60 transition-colors flex-shrink-0 mt-0.5"
                />
              </div>

              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {related.sharedEntities.slice(0, 3).map((entity) => (
                  <span
                    key={entity.entityId}
                    className={cn(
                      "inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded-full",
                      ENTITY_TYPE_COLORS[entity.entityType]
                    )}
                  >
                    {ENTITY_TYPE_ICONS[entity.entityType]}
                    {entity.displayName}
                  </span>
                ))}
                {related.sharedEntities.length > 3 && (
                  <span className="text-[9px] text-white/30">
                    +{related.sharedEntities.length - 3} more
                  </span>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

/**
 * Entity badge for displaying in memory views
 */
export interface EntityBadgeProps {
  entityType: EntityType
  displayName: string
  className?: string
}

export function EntityBadge({ entityType, displayName, className }: EntityBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded-full",
        ENTITY_TYPE_COLORS[entityType],
        className
      )}
    >
      {ENTITY_TYPE_ICONS[entityType]}
      {displayName}
    </span>
  )
}
