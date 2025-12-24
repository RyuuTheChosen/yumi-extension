/**
 * Memory Editor Modal
 *
 * Modal dialog for editing or deleting a single memory.
 */

import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Save, Trash2, AlertTriangle } from 'lucide-react'
import { cn } from '../../lib/design/utils'
import type { Memory, MemoryType, MemoryUpdate } from '../../lib/memory'

const MEMORY_TYPES: MemoryType[] = [
  'identity',
  'preference',
  'skill',
  'project',
  'person',
  'event',
  'opinion',
]

const TYPE_LABELS: Record<MemoryType, string> = {
  identity: 'Identity (name, job, location)',
  preference: 'Preference (likes, dislikes)',
  skill: 'Skill (technologies, abilities)',
  project: 'Project (work in progress)',
  person: 'Person (colleagues, family)',
  event: 'Event (recent happenings)',
  opinion: 'Opinion (views on topics)',
}

export interface MemoryEditorProps {
  memory: Memory
  isOpen: boolean
  onClose: () => void
  onSave: (id: string, updates: MemoryUpdate) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

export function MemoryEditor({
  memory,
  isOpen,
  onClose,
  onSave,
  onDelete,
}: MemoryEditorProps) {
  const [content, setContent] = useState(memory.content)
  const [context, setContext] = useState(memory.context || '')
  const [type, setType] = useState<MemoryType>(memory.type)
  const [importance, setImportance] = useState(memory.importance)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setContent(memory.content)
    setContext(memory.context || '')
    setType(memory.type)
    setImportance(memory.importance)
    setConfirmDelete(false)
    setError(null)
  }, [memory])

  const hasChanges =
    content !== memory.content ||
    context !== (memory.context || '') ||
    type !== memory.type ||
    importance !== memory.importance

  const handleSave = async () => {
    if (!content.trim()) {
      setError('Content cannot be empty')
      return
    }

    if (content.length > 2000) {
      setError('Content is too long (max 2000 characters)')
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const updates: MemoryUpdate = {}

      if (content !== memory.content) updates.content = content.trim()
      if (context !== (memory.context || '')) updates.context = context.trim() || undefined
      if (type !== memory.type) updates.type = type
      if (importance !== memory.importance) updates.importance = importance

      await onSave(memory.id, updates)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }

    setIsDeleting(true)
    try {
      await onDelete(memory.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setIsDeleting(false)
    }
  }

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
          className="w-full max-w-md mx-4 bg-mono-900 rounded-xl border border-white/15 shadow-2xl overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <h2 className="text-sm font-medium text-white">Edit Memory</h2>
            <button
              onClick={onClose}
              className="p-1 rounded text-white/50 hover:text-white hover:bg-white/10"
            >
              <X size={16} />
            </button>
          </div>

          <div className="p-4 space-y-4">
            <div>
              <label className="block text-xs text-white/50 mb-1.5">Type</label>
              <select
                value={type}
                onChange={e => setType(e.target.value as MemoryType)}
                className={cn(
                  "w-full px-3 py-2 text-xs rounded-lg",
                  "border border-white/20 bg-white/5 text-white",
                  "focus:outline-none focus:bg-white/10 focus:border-white/40"
                )}
              >
                {MEMORY_TYPES.map(t => (
                  <option key={t} value={t} className="bg-mono-900">
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-white/50 mb-1.5">
                Content <span className="text-white/30">({content.length}/2000)</span>
              </label>
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="What Yumi remembers..."
                rows={3}
                className={cn(
                  "w-full px-3 py-2 text-xs rounded-lg resize-none",
                  "border border-white/20 bg-white/5 text-white placeholder:text-white/30",
                  "focus:outline-none focus:bg-white/10 focus:border-white/40"
                )}
              />
            </div>

            <div>
              <label className="block text-xs text-white/50 mb-1.5">
                Context <span className="text-white/30">(optional)</span>
              </label>
              <input
                type="text"
                value={context}
                onChange={e => setContext(e.target.value)}
                placeholder="Where this came up..."
                className={cn(
                  "w-full px-3 py-2 text-xs rounded-lg",
                  "border border-white/20 bg-white/5 text-white placeholder:text-white/30",
                  "focus:outline-none focus:bg-white/10 focus:border-white/40"
                )}
              />
            </div>

            <div>
              <label className="block text-xs text-white/50 mb-1.5">
                Importance: {Math.round(importance * 100)}%
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={importance}
                onChange={e => setImportance(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-blue-500"
              />
              <div className="flex justify-between text-[10px] text-white/30 mt-1">
                <span>Low</span>
                <span>High</span>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                <AlertTriangle size={14} className="text-red-400 flex-shrink-0" />
                <span className="text-xs text-red-300">{error}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between p-4 border-t border-white/10 bg-white/5">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-300">Delete this memory?</span>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-2 py-1 text-[10px] rounded bg-white/10 text-white/70 hover:bg-white/20"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className={cn(
                    "px-2 py-1 text-[10px] rounded",
                    "bg-red-500/20 text-red-300 hover:bg-red-500/30",
                    isDeleting && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {isDeleting ? 'Deleting...' : 'Confirm'}
                </button>
              </div>
            ) : (
              <button
                onClick={handleDelete}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg text-red-400 hover:bg-red-500/10"
              >
                <Trash2 size={14} />
                Delete
              </button>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs rounded-lg text-white/50 hover:text-white hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!hasChanges || isSaving}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg",
                  "bg-blue-500/20 text-blue-300 hover:bg-blue-500/30",
                  (!hasChanges || isSaving) && "opacity-50 cursor-not-allowed"
                )}
              >
                <Save size={14} />
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
