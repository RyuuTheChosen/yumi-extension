import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { cn } from '../../lib/design/utils';
import type { SearchResult } from '../../lib/search/types';

interface SourcesCardProps {
  sources: SearchResult[];
}

/**
 * Extract domain from URL for display and favicon.
 */
function getDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Get favicon URL using Google's favicon service.
 */
function getFaviconUrl(url: string): string {
  const domain = getDomain(url);
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

/**
 * Truncate content snippet for preview.
 */
function truncateSnippet(content: string, maxLength = 80): string {
  if (!content) return '';
  const cleaned = content.trim().replace(/\s+/g, ' ');
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.slice(0, maxLength).trim() + '...';
}

export function SourcesCard({ sources }: SourcesCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [failedFavicons, setFailedFavicons] = useState<Set<number>>(new Set());

  if (!sources || sources.length === 0) return null;

  const handleFaviconError = (index: number) => {
    setFailedFavicons(prev => new Set(prev).add(index));
  };

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs',
          'bg-white/5 hover:bg-white/10 text-white/60 transition-colors w-full'
        )}
      >
        <div className="flex -space-x-1">
          {sources.slice(0, 3).map((source, i) => (
            <img
              key={i}
              src={getFaviconUrl(source.url)}
              alt=""
              className="w-3.5 h-3.5 rounded-sm bg-white/10"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ))}
        </div>
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
            <div className="mt-1.5 space-y-2">
              {sources.map((source, index) => (
                <a
                  key={index}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    'flex items-start gap-2.5 px-3 py-2.5 rounded-lg',
                    'bg-white/5 hover:bg-white/15 transition-colors group'
                  )}
                >
                  <div className="flex-shrink-0 w-5 h-5 rounded bg-white/10 flex items-center justify-center overflow-hidden mt-0.5">
                    {!failedFavicons.has(index) ? (
                      <img
                        src={getFaviconUrl(source.url)}
                        alt=""
                        className="w-4 h-4"
                        onError={() => handleFaviconError(index)}
                      />
                    ) : (
                      <span className="text-[10px] text-white/50 font-medium">
                        {getDomain(source.url).charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white/80 truncate leading-tight">
                      {source.title}
                    </p>
                    <p className="text-[10px] text-white/40 truncate mt-0.5">
                      {getDomain(source.url)}
                      {source.publishedDate && (
                        <span className="ml-1.5 text-white/30">
                          {source.publishedDate}
                        </span>
                      )}
                    </p>
                    {source.content && (
                      <p className="text-[10px] text-white/50 mt-1 line-clamp-2 leading-relaxed">
                        {truncateSnippet(source.content, 120)}
                      </p>
                    )}
                  </div>

                  <ExternalLink
                    size={12}
                    className="flex-shrink-0 text-white/30 group-hover:text-white/60 transition-colors mt-0.5"
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
