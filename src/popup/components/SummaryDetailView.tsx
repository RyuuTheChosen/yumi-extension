/**
 * Summary Detail View
 *
 * Displays full conversation summary details in a modal view.
 */

import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Clock, Calendar, MessageSquare, Link, Tag, Trash2, Brain } from 'lucide-react'
import { cn } from '../../lib/design/utils'
import type { ConversationSummary } from '../../lib/memory'

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

export interface SummaryDetailViewProps {
  summary: ConversationSummary
  isOpen: boolean
  onClose: () => void
  onDelete: (id: string) => void
  onViewMemory?: (memoryId: string) => void
}

export function SummaryDetailView({
  summary,
  isOpen,
  onClose,
  onDelete,
  onViewMemory,
}: SummaryDetailViewProps) {
  if (!isOpen) return null

  const handleDelete = () => {
    if (confirm('Delete this conversation summary?')) {
      onDelete(summary.id)
      onClose()
    }
  }

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
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-white/10 flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-indigo-500/20 text-indigo-300">
                Conversation Summary
              </span>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded text-white/50 hover:text-white hover:bg-white/10"
            >
              <X size={16} />
            </button>
          </div>

          {/* Content */}
          <div className="p-4 space-y-4 overflow-y-auto flex-1">
            {/* Summary Text */}
            <div>
              <p className="text-sm text-white leading-relaxed">{summary.summary}</p>
            </div>

            {/* Key Topics */}
            {summary.keyTopics.length > 0 && (
              <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center gap-1.5 text-white/40 mb-2">
                  <Tag size={12} />
                  <span className="text-[10px]">Key Topics</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {summary.keyTopics.map((topic, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 text-[10px] rounded-full bg-indigo-500/20 text-indigo-300"
                    >
                      {topic}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Time Range */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center gap-1.5 text-white/40 mb-1">
                  <Calendar size={12} />
                  <span className="text-[10px]">Started</span>
                </div>
                <p className="text-xs text-white/70">
                  {formatDate(summary.conversationStartedAt)}
                </p>
                <p className="text-[10px] text-white/30">
                  {formatRelativeTime(summary.conversationStartedAt)}
                </p>
              </div>

              <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center gap-1.5 text-white/40 mb-1">
                  <Clock size={12} />
                  <span className="text-[10px]">Ended</span>
                </div>
                <p className="text-xs text-white/70">
                  {formatDate(summary.conversationEndedAt)}
                </p>
                <p className="text-[10px] text-white/30">
                  {formatRelativeTime(summary.conversationEndedAt)}
                </p>
              </div>
            </div>

            {/* Stats */}
            <div className="p-3 rounded-lg bg-white/5 border border-white/10">
              <div className="flex items-center gap-1.5 text-white/40 mb-2">
                <MessageSquare size={12} />
                <span className="text-[10px]">Conversation Stats</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/50">Messages:</span>
                <span className="text-xs text-white">{summary.messageCount}</span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-white/50">Memories extracted:</span>
                <span className="text-xs text-white">{summary.memoryIds.length}</span>
              </div>
            </div>

            {/* Source URL */}
            {summary.url && (
              <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center gap-1.5 text-white/40 mb-2">
                  <Link size={12} />
                  <span className="text-[10px]">Source</span>
                </div>
                <p className="text-[10px] text-white/50 break-all">
                  {summary.url}
                </p>
              </div>
            )}

            {/* Linked Memories */}
            {summary.memoryIds.length > 0 && onViewMemory && (
              <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center gap-1.5 text-white/40 mb-2">
                  <Brain size={12} />
                  <span className="text-[10px]">Linked Memories</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {summary.memoryIds.slice(0, 5).map((memoryId) => (
                    <button
                      key={memoryId}
                      onClick={() => onViewMemory(memoryId)}
                      className="px-2 py-0.5 text-[10px] rounded bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-colors"
                    >
                      View memory
                    </button>
                  ))}
                  {summary.memoryIds.length > 5 && (
                    <span className="px-2 py-0.5 text-[10px] text-white/40">
                      +{summary.memoryIds.length - 5} more
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between p-4 border-t border-white/10 bg-white/5 flex-shrink-0">
            <p className="text-[10px] text-white/30 font-mono truncate max-w-[200px]">
              ID: {summary.id}
            </p>
            <button
              onClick={handleDelete}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg",
                "text-red-400 hover:bg-red-500/10"
              )}
            >
              <Trash2 size={14} />
              Delete
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
