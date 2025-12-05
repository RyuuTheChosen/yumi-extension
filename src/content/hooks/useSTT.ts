/**
 * Speech-to-Text Hook
 *
 * Listens for STT results from overlay button and auto-expands chat.
 * Appends recognized text to message input.
 */

import { useEffect } from 'react'
import { setChatOpen } from '../chatState'
import type { MessageInputHandle } from '../components/MessageInput'

export interface UseSTTOptions {
  messageInputRef: React.RefObject<MessageInputHandle | null>
  isExpanded: boolean
  setIsExpanded: (expanded: boolean) => void
  onToggle?: (isOpen: boolean) => void
}

/**
 * Custom hook for Speech-to-Text integration
 *
 * Listens for custom 'yumi-stt-result' events dispatched by the STT button.
 * Automatically expands the chat overlay and appends recognized text to input.
 */
export function useSTT(options: UseSTTOptions): void {
  const { messageInputRef, isExpanded, setIsExpanded, onToggle } = options

  useEffect(() => {
    const handleSTTResult = (e: Event) => {
      const customEvent = e as CustomEvent<{ text: string }>
      if (customEvent.detail?.text && messageInputRef.current) {
        messageInputRef.current.appendText(customEvent.detail.text)

        if (!isExpanded) {
          setIsExpanded(true)
          setChatOpen(true)
          onToggle?.(true)
        }
      }
    }

    document.addEventListener('yumi-stt-result', handleSTTResult)
    return () => document.removeEventListener('yumi-stt-result', handleSTTResult)
  }, [messageInputRef, isExpanded, setIsExpanded, onToggle])
}
