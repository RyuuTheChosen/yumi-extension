/**
 * Summary Browser
 *
 * List view of conversation summaries with search and filtering.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageSquare, Clock, Tag, Trash2, ChevronRight, FileText } from 'lucide-react'
import { cn } from '../../lib/design/utils'
import type { ConversationSummary } from '../../lib/memory'
import { SummaryDetailView } from './SummaryDetailView'

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

export interface SummaryBrowserProps {
  onViewMemory?: (memoryId: string) => void
}

export function SummaryBrowser({ onViewMemory }: SummaryBrowserProps) {
  const [summaries, setSummaries] = useState<ConversationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSummary, setSelectedSummary] = useState<ConversationSummary | null>(null)

  const loadSummaries = useCallback(async () => {
    setLoading(true)
    try {
      const response = await chrome.runtime.sendMessage({ type: 'SUMMARY_GET_ALL' })
      if (response.success && response.summaries) {
        setSummaries(response.summaries)
      }
    } catch (err) {
      console.error('Failed to load summaries:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSummaries()
  }, [loadSummaries])

  const handleDelete = async (id: string) => {
    try {
      await chrome.runtime.sendMessage({
        type: 'SUMMARY_DELETE',
        payload: { id }
      })
      setSummaries(prev => prev.filter(s => s.id !== id))
    } catch (err) {
      console.error('Failed to delete summary:', err)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 mx-auto border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
          <p className="text-xs text-white/50">Loading summaries...</p>
        </div>
      </div>
    )
  }

  if (summaries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <FileText size={32} className="text-white/20 mb-3" />
        <p className="text-sm text-white/50 text-center">No conversation summaries yet</p>
        <p className="text-xs text-white/30 text-center mt-1">
          Summaries are generated from longer conversations
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-2">
        <AnimatePresence mode="popLayout">
          {summaries.map((summary, index) => (
            <motion.div
              key={summary.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ delay: index * 0.03 }}
              className={cn(
                "group p-3 rounded-lg cursor-pointer transition-all",
                "bg-white/5 border border-white/10",
                "hover:bg-white/10 hover:border-indigo-500/30"
              )}
              onClick={() => setSelectedSummary(summary)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  {/* Summary preview */}
                  <p className="text-xs text-white/80 line-clamp-2 leading-relaxed">
                    {summary.summary}
                  </p>

                  {/* Topics */}
                  {summary.keyTopics.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {summary.keyTopics.slice(0, 3).map((topic, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] rounded-full bg-indigo-500/20 text-indigo-300"
                        >
                          <Tag size={8} />
                          {topic}
                        </span>
                      ))}
                      {summary.keyTopics.length > 3 && (
                        <span className="text-[9px] text-white/30">
                          +{summary.keyTopics.length - 3}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Meta info */}
                  <div className="flex items-center gap-3 mt-2">
                    <span className="flex items-center gap-1 text-[10px] text-white/40">
                      <Clock size={10} />
                      {formatRelativeTime(summary.conversationEndedAt)}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] text-white/40">
                      <MessageSquare size={10} />
                      {summary.messageCount} msgs
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm('Delete this summary?')) {
                        handleDelete(summary.id)
                      }
                    }}
                    className="p-1.5 rounded text-white/40 hover:text-red-400 hover:bg-red-500/10"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                  <ChevronRight size={14} className="text-white/30" />
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Detail Modal */}
      {selectedSummary && (
        <SummaryDetailView
          summary={selectedSummary}
          isOpen={!!selectedSummary}
          onClose={() => setSelectedSummary(null)}
          onDelete={handleDelete}
          onViewMemory={onViewMemory}
        />
      )}
    </>
  )
}
