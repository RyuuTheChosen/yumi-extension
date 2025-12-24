/**
 * Memory Detail View
 *
 * Displays full memory details with all metadata in a modal view.
 */

import React, { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Clock, Calendar, Eye, Link, Edit3, CheckCircle, ThumbsUp, ThumbsDown, Zap, TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '../../lib/design/utils'
import { calculateDecayedImportance } from '../../lib/memory'
import type { Memory, MemoryType } from '../../lib/memory'
import { RelatedMemories } from './RelatedMemories'

const TYPE_COLORS: Record<MemoryType, string> = {
  identity: 'bg-blue-500/20 text-blue-300',
  preference: 'bg-purple-500/20 text-purple-300',
  skill: 'bg-green-500/20 text-green-300',
  project: 'bg-yellow-500/20 text-yellow-300',
  person: 'bg-pink-500/20 text-pink-300',
  event: 'bg-orange-500/20 text-orange-300',
  opinion: 'bg-cyan-500/20 text-cyan-300',
}

const TYPE_DESCRIPTIONS: Record<MemoryType, string> = {
  identity: 'Core identity fact (never decays)',
  preference: 'Personal preference (90 day half-life)',
  skill: 'Skill or technology (60 day half-life)',
  project: 'Active project (30 day half-life)',
  person: 'Person in their life (60 day half-life)',
  event: 'Recent event (7 day half-life)',
  opinion: 'Opinion or view (14 day half-life)',
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

export interface MemoryDetailViewProps {
  memory: Memory
  isOpen: boolean
  onClose: () => void
  onEdit: (memory: Memory) => void
  onSelectRelatedMemory?: (memory: Memory) => void
}

export function MemoryDetailView({
  memory,
  isOpen,
  onClose,
  onEdit,
  onSelectRelatedMemory,
}: MemoryDetailViewProps) {
  const effectiveImportance = calculateDecayedImportance(memory)

  const handleSelectRelatedMemory = useCallback((relatedMemory: Memory) => {
    onSelectRelatedMemory?.(relatedMemory)
  }, [onSelectRelatedMemory])

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2 }}
          className="w-full max-w-md mx-4 bg-mono-900 rounded-xl border border-white/15 shadow-2xl overflow-hidden max-h-[80vh] flex flex-col"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-4 border-b border-white/10 flex-shrink-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={cn(
                  "px-2 py-0.5 text-[10px] font-medium rounded-full",
                  TYPE_COLORS[memory.type]
                )}
              >
                {memory.type}
              </span>
              {memory.userVerified && (
                <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-green-500/20 text-green-300 flex items-center gap-1">
                  <CheckCircle size={10} />
                  Verified
                </span>
              )}
              <span className="text-[10px] text-white/30">
                {TYPE_DESCRIPTIONS[memory.type]}
              </span>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded text-white/50 hover:text-white hover:bg-white/10"
            >
              <X size={16} />
            </button>
          </div>

          <div className="p-4 space-y-4 overflow-y-auto flex-1">
            <div>
              <p className="text-sm text-white leading-relaxed">{memory.content}</p>
              {memory.context && (
                <p className="text-xs text-white/40 mt-2 italic">
                  Context: {memory.context}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center gap-1.5 text-white/40 mb-1">
                  <Calendar size={12} />
                  <span className="text-[10px]">Created</span>
                </div>
                <p className="text-xs text-white/70">
                  {formatDate(memory.createdAt)}
                </p>
                <p className="text-[10px] text-white/30">
                  {formatRelativeTime(memory.createdAt)}
                </p>
              </div>

              <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center gap-1.5 text-white/40 mb-1">
                  <Clock size={12} />
                  <span className="text-[10px]">Last Accessed</span>
                </div>
                <p className="text-xs text-white/70">
                  {formatDate(memory.lastAccessed)}
                </p>
                <p className="text-[10px] text-white/30">
                  {formatRelativeTime(memory.lastAccessed)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-center">
                <p className="text-xs text-white/40 mb-1">Importance</p>
                <p className="text-lg font-medium text-white">
                  {Math.round(memory.importance * 100)}%
                </p>
              </div>

              <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-center">
                <p className="text-xs text-white/40 mb-1">Effective</p>
                <p className={cn(
                  "text-lg font-medium",
                  effectiveImportance >= memory.importance
                    ? "text-green-400"
                    : "text-yellow-400"
                )}>
                  {Math.round(effectiveImportance * 100)}%
                </p>
              </div>

              <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-center">
                <p className="text-xs text-white/40 mb-1">Confidence</p>
                <p className="text-lg font-medium text-white">
                  {Math.round(memory.confidence * 100)}%
                </p>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-white/5 border border-white/10">
              <div className="flex items-center gap-1.5 text-white/40 mb-2">
                <Eye size={12} />
                <span className="text-[10px]">Access Stats</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/50">Times accessed:</span>
                <span className="text-xs text-white">{memory.accessCount}</span>
              </div>
              {memory.usageCount !== undefined && memory.usageCount > 0 && (
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-white/50">Times used in chat:</span>
                  <span className="text-xs text-white">{memory.usageCount}</span>
                </div>
              )}
              {memory.lastUsedAt && (
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-white/50">Last used:</span>
                  <span className="text-xs text-white">{formatRelativeTime(memory.lastUsedAt)}</span>
                </div>
              )}
            </div>

            {/* Feedback & Learning Section */}
            <div className="p-3 rounded-lg bg-white/5 border border-white/10">
              <div className="flex items-center gap-1.5 text-white/40 mb-2">
                <Zap size={12} />
                <span className="text-[10px]">Feedback & Learning</span>
              </div>

              {/* Feedback Score Bar */}
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-white/50">Feedback score:</span>
                  <span className={cn(
                    "text-xs font-medium",
                    (memory.feedbackScore ?? 0) > 0 ? "text-green-400" :
                    (memory.feedbackScore ?? 0) < 0 ? "text-red-400" : "text-white/50"
                  )}>
                    {(memory.feedbackScore ?? 0) > 0 ? '+' : ''}{((memory.feedbackScore ?? 0) * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full transition-all",
                      (memory.feedbackScore ?? 0) >= 0 ? "bg-green-500" : "bg-red-500"
                    )}
                    style={{
                      width: `${Math.abs(memory.feedbackScore ?? 0) * 50}%`,
                      marginLeft: (memory.feedbackScore ?? 0) < 0 ? `${50 - Math.abs(memory.feedbackScore ?? 0) * 50}%` : '50%'
                    }}
                  />
                </div>
              </div>

              {/* Interaction Counts */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <ThumbsUp size={12} className="text-green-400" />
                  <span className="text-xs text-white/70">{memory.positiveInteractions ?? 0}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ThumbsDown size={12} className="text-red-400" />
                  <span className="text-xs text-white/70">{memory.negativeInteractions ?? 0}</span>
                </div>

                {/* Decay Rate */}
                {memory.adaptiveDecayRate !== undefined && memory.adaptiveDecayRate !== 1.0 && (
                  <div className="flex items-center gap-1.5 ml-auto">
                    {memory.adaptiveDecayRate < 1.0 ? (
                      <>
                        <TrendingUp size={12} className="text-green-400" />
                        <span className="text-[10px] text-green-400">Slower decay</span>
                      </>
                    ) : (
                      <>
                        <TrendingDown size={12} className="text-yellow-400" />
                        <span className="text-[10px] text-yellow-400">Faster decay</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {memory.source.url && (
              <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center gap-1.5 text-white/40 mb-2">
                  <Link size={12} />
                  <span className="text-[10px]">Source</span>
                </div>
                <p className="text-[10px] text-white/50 break-all">
                  {memory.source.url}
                </p>
              </div>
            )}

            {memory.expiresAt && (
              <div className="p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                <p className="text-xs text-yellow-300">
                  Expires: {formatDate(memory.expiresAt)}
                </p>
              </div>
            )}

            <RelatedMemories
              memoryId={memory.id}
              onSelectMemory={handleSelectRelatedMemory}
            />
          </div>

          <div className="flex items-center justify-between p-4 border-t border-white/10 bg-white/5 flex-shrink-0">
            <div className="flex items-center gap-2">
              <p className="text-[10px] text-white/30 font-mono truncate max-w-[150px]">
                ID: {memory.id}
              </p>
              {memory.embedding && (
                <span className="px-1.5 py-0.5 text-[9px] rounded bg-blue-500/20 text-blue-300">
                  Embedded
                </span>
              )}
            </div>
            <button
              onClick={() => onEdit(memory)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg",
                "bg-blue-500/20 text-blue-300 hover:bg-blue-500/30"
              )}
            >
              <Edit3 size={14} />
              Edit
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
