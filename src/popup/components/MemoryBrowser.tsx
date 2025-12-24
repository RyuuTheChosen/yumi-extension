import React, { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Brain, Search, Trash2, X, MessageCircle, Clock, Edit3, CheckSquare, Square, FileText } from 'lucide-react'
import { cn } from '../../lib/design/utils'
import { useMemoryStore, loadProactiveHistory } from '../../lib/memory'
import type { Memory, MemoryType, MemoryUpdate, ProactiveHistoryEntry } from '../../lib/memory'
import { createLogger } from '../../lib/core/debug'
import { MemoryEditor } from './MemoryEditor'
import { MemoryDetailView } from './MemoryDetailView'
import { SummaryBrowser } from './SummaryBrowser'

const log = createLogger('MemoryBrowser')

const TYPE_COLORS: Record<MemoryType, string> = {
  identity: 'bg-blue-500/20 text-blue-300',
  preference: 'bg-purple-500/20 text-purple-300',
  skill: 'bg-green-500/20 text-green-300',
  project: 'bg-yellow-500/20 text-yellow-300',
  person: 'bg-pink-500/20 text-pink-300',
  event: 'bg-orange-500/20 text-orange-300',
  opinion: 'bg-cyan-500/20 text-cyan-300',
}

const MEMORY_TYPES: MemoryType[] = [
  'identity',
  'preference',
  'skill',
  'project',
  'person',
  'event',
  'opinion',
]

type SortOption = 'newest' | 'oldest' | 'type'
type TabOption = 'memories' | 'proactive' | 'summaries'

const PROACTIVE_TYPE_COLORS: Record<string, string> = {
  welcome_back: 'bg-green-500/20 text-green-300',
  follow_up: 'bg-yellow-500/20 text-yellow-300',
  context_match: 'bg-blue-500/20 text-blue-300',
  random_recall: 'bg-purple-500/20 text-purple-300',
}

const PROACTIVE_TYPE_LABELS: Record<string, string> = {
  welcome_back: 'Welcome Back',
  follow_up: 'Follow-up',
  context_match: 'Context',
  random_recall: 'Recall',
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

function getImportance(memory: Memory): number {
  if (memory.type === 'identity') return 1

  const ageMs = Date.now() - memory.createdAt
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  const halfLife = memory.type === 'preference' ? 60 : 30

  return Math.pow(0.5, ageDays / halfLife)
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text

  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  const parts = text.split(regex)

  return parts.map((part, i) =>
    regex.test(part)
      ? <mark key={i} className="bg-yellow-500/30 text-white rounded px-0.5">{part}</mark>
      : part
  )
}

export function MemoryBrowser() {
  const [activeTab, setActiveTab] = useState<TabOption>('memories')
  const [typeFilter, setTypeFilter] = useState<MemoryType | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('newest')
  const [confirmClearAll, setConfirmClearAll] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [proactiveHistory, setProactiveHistory] = useState<ProactiveHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  /** Multi-select state */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)

  /** Modal states */
  const [detailMemory, setDetailMemory] = useState<Memory | null>(null)
  const [editMemory, setEditMemory] = useState<Memory | null>(null)

  const memories = useMemoryStore(s => s.memories)
  const isLoaded = useMemoryStore(s => s.isLoaded)
  const loadMemories = useMemoryStore(s => s.loadMemories)
  const removeMemory = useMemoryStore(s => s.removeMemory)
  const removeMemories = useMemoryStore(s => s.removeMemories)
  const updateMemory = useMemoryStore(s => s.updateMemory)
  const clearAll = useMemoryStore(s => s.clearAll)

  useEffect(() => {
    log.log('Loading memories...')
    loadMemories().then(() => {
      log.log('Loaded, count:', useMemoryStore.getState().memories.length)
    }).catch(err => {
      log.error('Load failed:', err)
    })

    setHistoryLoading(true)
    loadProactiveHistory().then(history => {
      setProactiveHistory(history)
      setHistoryLoading(false)
      log.log('Loaded proactive history:', history.length)
    }).catch(err => {
      log.error('History load failed:', err)
      setHistoryLoading(false)
    })
  }, [loadMemories])

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: memories.length }
    for (const type of MEMORY_TYPES) {
      counts[type] = memories.filter(m => m.type === type).length
    }
    return counts
  }, [memories])

  const filteredMemories = useMemo(() => {
    let result = [...memories]

    if (typeFilter !== 'all') {
      result = result.filter(m => m.type === typeFilter)
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(m =>
        m.content.toLowerCase().includes(q) ||
        m.context?.toLowerCase().includes(q)
      )
    }

    switch (sortBy) {
      case 'oldest':
        result.sort((a, b) => a.createdAt - b.createdAt)
        break
      case 'type':
        result.sort((a, b) => a.type.localeCompare(b.type))
        break
      default:
        result.sort((a, b) => b.createdAt - a.createdAt)
    }

    return result
  }, [memories, typeFilter, searchQuery, sortBy])

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleDelete = async (id: string) => {
    await removeMemory(id)
  }

  const handleClearAll = async () => {
    await clearAll()
    setConfirmClearAll(false)
  }

  /** Toggle selection for a memory */
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  /** Select or deselect all visible memories */
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredMemories.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredMemories.map(m => m.id)))
    }
  }

  /** Exit select mode */
  const exitSelectMode = () => {
    setIsSelectMode(false)
    setSelectedIds(new Set())
    setConfirmBulkDelete(false)
  }

  /** Bulk delete selected memories */
  const handleBulkDelete = async () => {
    if (!confirmBulkDelete) {
      setConfirmBulkDelete(true)
      return
    }

    await removeMemories(Array.from(selectedIds))
    exitSelectMode()
  }

  /** Handle save from editor */
  const handleSave = async (id: string, updates: MemoryUpdate) => {
    await updateMemory(id, updates)
  }

  /** Open detail view, or toggle select in select mode */
  const handleMemoryClick = (memory: Memory) => {
    if (isSelectMode) {
      toggleSelect(memory.id)
    } else {
      setDetailMemory(memory)
    }
  }

  /** Open editor from detail view */
  const handleEditFromDetail = (memory: Memory) => {
    setDetailMemory(null)
    setEditMemory(memory)
  }

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center py-12">
        <motion.span
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-5 h-5 border-2 border-white/30 border-t-white/70 rounded-full"
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 mb-3 p-1 rounded-lg bg-white/5">
        <button
          onClick={() => setActiveTab('memories')}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors",
            activeTab === 'memories'
              ? "bg-white/15 text-white"
              : "text-white/50 hover:text-white/70"
          )}
        >
          <Brain size={12} />
          Memories ({memories.length})
        </button>
        <button
          onClick={() => setActiveTab('proactive')}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors",
            activeTab === 'proactive'
              ? "bg-white/15 text-white"
              : "text-white/50 hover:text-white/70"
          )}
        >
          <MessageCircle size={12} />
          Activity
        </button>
        <button
          onClick={() => setActiveTab('summaries')}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors",
            activeTab === 'summaries'
              ? "bg-white/15 text-white"
              : "text-white/50 hover:text-white/70"
          )}
        >
          <FileText size={12} />
          Summaries
        </button>
      </div>

      {activeTab === 'memories' && (
        <>
      <div className="flex items-center justify-between mb-3">
        {isSelectMode ? (
          <>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-1.5 px-2 py-1 text-[10px] rounded bg-white/10 text-white/70 hover:bg-white/20"
              >
                {selectedIds.size === filteredMemories.length ? (
                  <CheckSquare size={12} />
                ) : (
                  <Square size={12} />
                )}
                {selectedIds.size === filteredMemories.length ? 'Deselect All' : 'Select All'}
              </button>
              <span className="text-[10px] text-white/50">
                {selectedIds.size} selected
              </span>
            </div>
            <div className="flex items-center gap-2">
              {selectedIds.size > 0 && (
                confirmBulkDelete ? (
                  <>
                    <button
                      onClick={() => setConfirmBulkDelete(false)}
                      className="px-2 py-1 text-[10px] rounded bg-white/10 text-white/70 hover:bg-white/20"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleBulkDelete}
                      className="px-2 py-1 text-[10px] rounded bg-red-500/20 text-red-300 hover:bg-red-500/30"
                    >
                      Delete {selectedIds.size}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleBulkDelete}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] rounded text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 size={10} />
                    Delete
                  </button>
                )
              )}
              <button
                onClick={exitSelectMode}
                className="px-2 py-1 text-[10px] rounded text-white/50 hover:text-white hover:bg-white/10"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-sm font-medium text-white">
              All Memories
            </h3>
            {memories.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsSelectMode(true)}
                  className="px-2 py-1 text-[10px] rounded text-white/50 hover:text-white hover:bg-white/5"
                >
                  Select
                </button>
                {confirmClearAll ? (
                  <>
                    <button
                      onClick={() => setConfirmClearAll(false)}
                      className="px-2 py-1 text-[10px] rounded bg-white/10 text-white/70 hover:bg-white/20"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleClearAll}
                      className="px-2 py-1 text-[10px] rounded bg-red-500/20 text-red-300 hover:bg-red-500/30"
                    >
                      Delete all
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmClearAll(true)}
                    className="px-2 py-1 text-[10px] rounded text-white/50 hover:text-red-400 hover:bg-white/5"
                  >
                    Clear All
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex gap-2 mb-3">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as MemoryType | 'all')}
          className={cn(
            "px-2 py-1.5 text-xs rounded-lg",
            "border border-white/20 bg-white/10 text-white",
            "focus:outline-none focus:bg-white/15 focus:border-white/40"
          )}
        >
          <option value="all" className="bg-mono-900">All ({typeCounts.all})</option>
          {MEMORY_TYPES.map(type => (
            <option key={type} value={type} className="bg-mono-900">
              {type} ({typeCounts[type]})
            </option>
          ))}
        </select>

        <div className="relative flex-1">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              "w-full pl-7 pr-3 py-1.5 text-xs rounded-lg",
              "border border-white/20 bg-white/10 text-white placeholder:text-white/40",
              "focus:outline-none focus:bg-white/15 focus:border-white/40"
            )}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
          className={cn(
            "px-2 py-1.5 text-xs rounded-lg",
            "border border-white/20 bg-white/10 text-white",
            "focus:outline-none focus:bg-white/15 focus:border-white/40"
          )}
        >
          <option value="newest" className="bg-mono-900">Newest</option>
          <option value="oldest" className="bg-mono-900">Oldest</option>
          <option value="type" className="bg-mono-900">By type</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
        {filteredMemories.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col items-center justify-center py-12 text-center"
          >
            <Brain size={32} className="text-white/20 mb-3" />
            <p className="text-sm text-white/50">
              {memories.length === 0
                ? "No memories yet. Chat with Yumi to create some!"
                : "No memories match your filter"}
            </p>
          </motion.div>
        ) : (
          <AnimatePresence mode="popLayout">
            {filteredMemories.map((memory, index) => {
              const isExpanded = expandedIds.has(memory.id)
              const isLong = memory.content.length > 120
              const isSelected = selectedIds.has(memory.id)

              return (
                <motion.div
                  key={memory.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20, transition: { duration: 0.15 } }}
                  transition={{ duration: 0.2, delay: index * 0.03 }}
                  onClick={() => handleMemoryClick(memory)}
                  className={cn(
                    "p-3 rounded-lg border bg-white/5 group cursor-pointer transition-colors",
                    isSelected
                      ? "border-blue-500/50 bg-blue-500/10"
                      : "border-white/15 hover:border-white/25"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {isSelectMode && (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleSelect(memory.id) }}
                          className="p-0.5"
                        >
                          {isSelected ? (
                            <CheckSquare size={14} className="text-blue-400" />
                          ) : (
                            <Square size={14} className="text-white/30" />
                          )}
                        </button>
                      )}
                      <span
                        className={cn(
                          "px-2 py-0.5 text-[10px] font-medium rounded-full",
                          TYPE_COLORS[memory.type]
                        )}
                      >
                        {memory.type}
                      </span>
                    </div>
                    {!isSelectMode && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditMemory(memory) }}
                          className="p-1 rounded text-white/30 hover:text-blue-400 hover:bg-white/5"
                          title="Edit memory"
                        >
                          <Edit3 size={12} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(memory.id) }}
                          className="p-1 rounded text-white/30 hover:text-red-400 hover:bg-white/5"
                          title="Delete memory"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-white/80 mt-2 leading-relaxed">
                    {isLong && !isExpanded
                      ? highlightText(memory.content.slice(0, 120) + '...', searchQuery)
                      : highlightText(memory.content, searchQuery)}
                  </p>
                  {isLong && (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleExpand(memory.id) }}
                      className="text-[10px] text-white/40 hover:text-white/60 mt-1"
                    >
                      {isExpanded ? 'Show less' : 'Show more'}
                    </button>
                  )}
                  {memory.context && (
                    <p className="text-[10px] text-white/40 mt-1">
                      {highlightText(memory.context, searchQuery)}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <p className="text-[10px] text-white/30">
                      {formatRelativeTime(memory.createdAt)}
                    </p>
                    <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          memory.type === 'identity' ? 'bg-blue-400' : 'bg-white/40'
                        )}
                        style={{ width: `${getImportance(memory) * 100}%` }}
                      />
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        )}
      </div>
        </>
      )}

      {activeTab === 'proactive' && (
        <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
          {historyLoading ? (
            <div className="flex items-center justify-center py-12">
              <motion.span
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                className="w-5 h-5 border-2 border-white/30 border-t-white/70 rounded-full"
              />
            </div>
          ) : proactiveHistory.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col items-center justify-center py-12 text-center"
            >
              <MessageCircle size={32} className="text-white/20 mb-3" />
              <p className="text-sm text-white/50">
                No proactive messages yet.
              </p>
              <p className="text-xs text-white/30 mt-1">
                Yumi will reach out when she has something relevant to share!
              </p>
            </motion.div>
          ) : (
            <AnimatePresence mode="popLayout">
              {proactiveHistory.map((entry, index) => (
                <motion.div
                  key={entry.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: index * 0.03 }}
                  className="p-3 rounded-lg border border-white/15 bg-white/5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={cn(
                        "px-2 py-0.5 text-[10px] font-medium rounded-full",
                        PROACTIVE_TYPE_COLORS[entry.type] || 'bg-white/20 text-white/70'
                      )}
                    >
                      {PROACTIVE_TYPE_LABELS[entry.type] || entry.type}
                    </span>
                    {entry.engaged !== null && (
                      <span className={cn(
                        "text-[10px]",
                        entry.engaged ? "text-green-400" : "text-white/30"
                      )}>
                        {entry.engaged ? 'Engaged' : 'Dismissed'}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-white/80 mt-2 leading-relaxed">
                    {entry.message}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <Clock size={10} className="text-white/30" />
                    <p className="text-[10px] text-white/30">
                      {formatRelativeTime(entry.timestamp)}
                    </p>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      )}

      {activeTab === 'summaries' && (
        <SummaryBrowser
          onViewMemory={(memoryId) => {
            const memory = memories.find(m => m.id === memoryId)
            if (memory) {
              setDetailMemory(memory)
            }
          }}
        />
      )}

      {detailMemory && (
        <MemoryDetailView
          memory={detailMemory}
          isOpen={!!detailMemory}
          onClose={() => setDetailMemory(null)}
          onEdit={handleEditFromDetail}
          onSelectRelatedMemory={setDetailMemory}
        />
      )}

      {editMemory && (
        <MemoryEditor
          memory={editMemory}
          isOpen={!!editMemory}
          onClose={() => setEditMemory(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}
