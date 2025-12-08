/**
 * Context Menu Hook
 *
 * Handles right-click context menu integration.
 * Receives selected text or element content and auto-expands chat.
 */

import { useState, useEffect } from 'react'
import { createLogger } from '../../lib/core/debug'
import { setChatOpen } from '../chatState'

const log = createLogger('useContextMenu')

export interface UseContextMenuOptions {
  setIsExpanded: (expanded: boolean) => void
  onToggle?: (isOpen: boolean) => void
}

export interface UseContextMenuReturn {
  prefilledContext: string | null
  contextSource: 'selection' | 'element' | null
  setPrefilledContext: (context: string | null) => void
  setContextSource: (source: 'selection' | 'element' | null) => void
}

/**
 * Custom hook for context menu integration
 *
 * Listens for 'yumi:open-with-context' events from right-click context menu.
 * Automatically expands chat and populates input with selected text or element content.
 */
export function useContextMenu(options: UseContextMenuOptions): UseContextMenuReturn {
  const { setIsExpanded, onToggle } = options

  const [prefilledContext, setPrefilledContext] = useState<string | null>(null)
  const [contextSource, setContextSource] = useState<'selection' | 'element' | null>(null)

  useEffect(() => {
    const handleContextEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ text: string; source: 'selection' | 'element' }>
      if (customEvent.detail?.text) {
        log.log('[useContextMenu] Context received:', customEvent.detail.source, customEvent.detail.text.slice(0, 100) + '...')
        setPrefilledContext(customEvent.detail.text)
        setContextSource(customEvent.detail.source)

        setIsExpanded(true)
        setChatOpen(true)
        onToggle?.(true)
      }
    }

    window.addEventListener('yumi:open-with-context', handleContextEvent)
    return () => window.removeEventListener('yumi:open-with-context', handleContextEvent)
  }, [setIsExpanded, onToggle])

  return {
    prefilledContext,
    contextSource,
    setPrefilledContext,
    setContextSource
  }
}
