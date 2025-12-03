import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ExternalLink, Globe } from 'lucide-react';
import { cn } from '../../lib/design/utils';
import type { SearchResult } from '../../lib/search/types';

interface SourcesCardProps {
  sources: SearchResult[];
}

/**
 * Extract domain from URL for display.
 */
function getDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function SourcesCard({ sources }: SourcesCardProps) {
  const [expanded, setExpanded] = useState(false);

  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs',
          'bg-white/5 hover:bg-white/10 text-white/60 transition-colors w-full'
        )}
      >
        <Globe size={12} />
        <span>{sources.length} source{sources.length !== 1 ? 's' : ''}</span>
        <ChevronDown
          size={12}
          className={cn(
            'ml-auto transition-transform duration-200',
            expanded && 'rotate-180'
          )}
        />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-1.5 space-y-1">
              {sources.map((source, index) => (
                <a
                  key={index}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg',
                    'bg-white/5 hover:bg-white/10 transition-colors group'
                  )}
                >
                  <div className="flex-shrink-0 w-5 h-5 rounded bg-white/10 flex items-center justify-center">
                    <Globe size={10} className="text-white/50" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white/80 truncate">
                      {source.title}
                    </p>
                    <p className="text-[10px] text-white/40 truncate">
                      {getDomain(source.url)}
                    </p>
                  </div>

                  <ExternalLink
                    size={12}
                    className="flex-shrink-0 text-white/30 group-hover:text-white/60 transition-colors"
                  />
                </a>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
