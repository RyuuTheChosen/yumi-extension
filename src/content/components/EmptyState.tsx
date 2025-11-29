/**
 * EmptyState Component
 * Clean welcome screen with suggestions
 */

import { motion } from 'framer-motion';
import { MessageCircle, History, Loader2 } from 'lucide-react';
import { cn } from '../../lib/design/utils';

interface EmptyStateProps {
  onSuggestionClick: (suggestion: string) => void;
  hasHistory?: boolean;
  historyCount?: number;
  historyLoading?: boolean;
  onReloadHistory?: () => void;
}

const suggestions = [
  'Explain this page',
  'Summarize the key points',
];

export function EmptyState({ onSuggestionClick, hasHistory = false, historyCount = 0, historyLoading = false, onReloadHistory }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-4 text-center">
      {/* Simple Icon */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="mb-4"
      >
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center"
          style={{
            background: 'rgba(255, 255, 255, 0.20)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.25)',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.10)'
          }}
        >
          <MessageCircle size={22} className="text-white/80" strokeWidth={2} />
        </div>
      </motion.div>

      {/* Welcome Text */}
      <motion.h2
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.3 }}
        className="text-base font-semibold text-white mb-1"
      >
        Hi! How can I help?
      </motion.h2>
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.3 }}
        className="text-xs text-white/60 max-w-[240px] mb-4"
      >
        Ask me anything about this page.
      </motion.p>

      {/* History Loading Indicator */}
      {historyLoading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mb-4 flex items-center gap-2 text-white/50 text-xs"
        >
          <Loader2 size={12} className="animate-spin" />
          <span>Checking history...</span>
        </motion.div>
      )}

      {/* History Reload Button */}
      {!historyLoading && hasHistory && onReloadHistory && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          onClick={onReloadHistory}
          className="mb-4 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 text-white/80 hover:bg-white/10"
        >
          <History size={12} />
          <span>Load previous ({historyCount})</span>
        </motion.button>
      )}

      {/* Suggestion Pills */}
      <div className="flex flex-col gap-1.5 w-full max-w-[260px]">
        {suggestions.map((suggestion, index) => (
          <motion.button
            key={suggestion}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + index * 0.05, duration: 0.25 }}
            onClick={() => onSuggestionClick(suggestion)}
            className={cn(
              'w-full px-3 py-2 rounded-lg text-xs font-medium transition-all',
              'border border-white/20 hover:border-white/40 hover:bg-white/10',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40',
              'text-left text-white/80'
            )}
          >
            {suggestion}
          </motion.button>
        ))}
      </div>
    </div>
  );
}
