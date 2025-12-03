import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X } from 'lucide-react';
import { cn } from '../../lib/design/utils';
import { SEARCH_CONFIG } from '../../lib/search/types';

interface SearchPromptProps {
  query: string;
  onSearch: () => void;
  onSkip: () => void;
  visible: boolean;
}

export function SearchPrompt({ query, onSearch, onSkip, visible }: SearchPromptProps) {
  const [timeLeft, setTimeLeft] = useState(SEARCH_CONFIG.promptDismissMs / 1000);

  useEffect(() => {
    if (!visible) return;

    setTimeLeft(SEARCH_CONFIG.promptDismissMs / 1000);

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          onSkip();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [visible, onSkip]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="mb-3 p-3 rounded-xl glass-bubble-ai"
        >
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
              <Search size={16} className="text-white/70" />
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm text-white/90 mb-2">
                Search the web for this?
              </p>
              <p className="text-xs text-white/50 truncate mb-3">
                "{query.length > 60 ? query.slice(0, 60) + '...' : query}"
              </p>

              <div className="flex items-center gap-2">
                <button
                  onClick={onSearch}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium',
                    'bg-white/20 hover:bg-white/30 text-white transition-colors'
                  )}
                >
                  <Search size={14} />
                  Search
                </button>

                <button
                  onClick={onSkip}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm',
                    'bg-white/5 hover:bg-white/10 text-white/60 transition-colors'
                  )}
                >
                  <X size={14} />
                  Skip
                </button>

                <span className="ml-auto text-[10px] text-white/30">
                  {timeLeft}s
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
