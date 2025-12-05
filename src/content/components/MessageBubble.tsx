import React, { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Copy, Check } from 'lucide-react';
import { cn, formatTimestamp } from '../../lib/design/utils';
import { useChatStore } from '../../lib/stores/chat.store';
import type { SearchResult } from '../../lib/search/types';
import { createLogger } from '../../lib/debug';

const log = createLogger('MessageBubble');

export interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  streaming?: boolean;
  timestamp?: number;
  personality?: {
    name: string;
    avatar?: string;
  };
  sources?: SearchResult[];
}

/**
 * MessageBubble Component (Memoized)
 *
 * Optimized with React.memo to prevent unnecessary re-renders.
 * Only re-renders when content, streaming status, or timestamp changes.
 */
export const MessageBubble = React.memo(function MessageBubble({
  role,
  content,
  streaming = false,
  timestamp = Date.now(),
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);

  /**
   * Performance fix: Access store functions directly in event handlers
   * instead of subscribing to them, preventing re-renders on store updates
   */
  const handleCancel = useCallback(() => {
    useChatStore.getState().cancelActive();
  }, []);

  const handleRetry = useCallback(() => {
    useChatStore.getState().retryLast();
  }, []);

  /**
   * Only subscribe to status for this specific message's error/cancel state
   * This is conditionally rendered so won't cause re-renders for all messages
   */
  const status = useChatStore(s => s.status);
  const isError = status === 'error';
  const isCanceled = status === 'canceled';

  if (role === 'system') return null;

  const isUser = role === 'user';

  // Guard: Ensure content is always a string
  const safeContent = typeof content === 'string'
    ? content
    : (content ? JSON.stringify(content) : '');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(safeContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      log.error('Failed to copy:', err);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={cn(
        'group flex flex-col gap-1 mb-3',
        isUser ? 'items-end' : 'items-start'
      )}
    >
      {/* Message Bubble */}
      <div
        className={cn(
          'relative px-4 py-2.5 max-w-[85%] text-white',
          isUser
            ? 'glass-bubble-user rounded-2xl rounded-br-md'
            : 'glass-bubble-ai rounded-2xl rounded-bl-md'
        )}
      >
        {/* Content */}
        <p className="text-sm whitespace-pre-wrap leading-relaxed">
          {safeContent || (
            streaming && (
              <span className="flex gap-1 py-1">
                <motion.span
                  className="w-1.5 h-1.5 bg-white rounded-full opacity-60"
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1, repeat: Infinity, delay: 0 }}
                />
                <motion.span
                  className="w-1.5 h-1.5 bg-white rounded-full opacity-60"
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1, repeat: Infinity, delay: 0.2 }}
                />
                <motion.span
                  className="w-1.5 h-1.5 bg-white rounded-full opacity-60"
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1, repeat: Infinity, delay: 0.4 }}
                />
              </span>
            )
          )}
        </p>
      </div>

      {/* Metadata Row */}
      <div className={cn(
        'flex items-center gap-2 px-1',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}>
        {/* Timestamp */}
        <span className="text-[11px] text-white/50">
          {formatTimestamp(timestamp)}
        </span>

        {/* Copy Button - Always visible for assistant messages */}
        {!isUser && !streaming && safeContent && (
          <button
            onClick={handleCopy}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            aria-label="Copy message"
          >
            {copied ? (
              <Check size={12} className="text-status-online" />
            ) : (
              <Copy size={12} className="text-white/50" />
            )}
          </button>
        )}

        {/* Cancel button during streaming */}
        {streaming && !isUser && (
          <button
            onClick={handleCancel}
            className="text-[11px] text-white/60 hover:text-white transition-colors"
          >
            Stop
          </button>
        )}

        {/* Error state */}
        {!isUser && isError && (
          <button
            onClick={handleRetry}
            className="text-[11px] text-error hover:text-error-dark font-medium transition-colors"
          >
            Retry
          </button>
        )}

        {/* Canceled state */}
        {!isUser && isCanceled && (
          <span className="text-[11px] text-white/40 italic">Stopped</span>
        )}
      </div>
    </motion.div>
  );
}, (prevProps, nextProps) => {
  /**
   * Custom equality function for React.memo
   * Only re-render if these specific props change
   */
  return (
    prevProps.role === nextProps.role &&
    prevProps.content === nextProps.content &&
    prevProps.streaming === nextProps.streaming &&
    prevProps.timestamp === nextProps.timestamp
  );
});
