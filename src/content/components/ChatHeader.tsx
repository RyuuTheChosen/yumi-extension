/**
 * FloatingMenu Component
 * Glass-styled floating menu button for chat overlay
 */

import { MoreVertical, Trash2, Download, EyeOff, Settings } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../lib/design/utils';

interface FloatingMenuProps {
  connected: boolean;
  onClearThread?: () => void;
  onExportThread?: () => void;
  onTogglePrivateMode?: () => void;
  privateMode?: boolean;
}

export function ChatHeader({
  connected,
  onClearThread,
  onExportThread,
  onTogglePrivateMode,
  privateMode = false
}: FloatingMenuProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleOpenSettings = () => {
    chrome.runtime.sendMessage({ type: 'open-popup' });
    setShowMenu(false);
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };

    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMenu]);

  return (
    <div
      className="absolute top-3 right-3 z-20"
      ref={menuRef}
    >
      {/* Status indicator */}
      <div
        className={cn(
          "absolute -left-2 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full transition-all duration-300",
          connected ? "bg-status-online" : "bg-status-busy animate-pulse"
        )}
        title={connected ? 'Connected' : 'Reconnecting...'}
      />

      {/* Menu button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setShowMenu(!showMenu);
        }}
        className={cn(
          'w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200',
          'bg-white/10 hover:bg-white/20 border border-white/20',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40',
          showMenu && 'bg-white/25'
        )}
        aria-label="More options"
        aria-expanded={showMenu}
      >
        <MoreVertical size={16} className="text-white/80" />
      </button>

      {/* Dropdown Menu */}
      <AnimatePresence>
        {showMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute top-full right-0 mt-2 w-48 rounded-xl overflow-hidden z-50"
            style={{
              background: 'rgba(20, 20, 20, 0.90)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
            }}
          >
            <div className="py-1">
              {onClearThread && (
                <button
                  onClick={() => {
                    onClearThread();
                    setShowMenu(false);
                  }}
                  className="w-full px-3 py-2.5 flex items-center gap-2.5 text-sm text-white/90 hover:bg-white/10 transition-colors text-left"
                >
                  <Trash2 size={15} className="text-white/60" />
                  <span>Clear conversation</span>
                </button>
              )}

              {onExportThread && (
                <button
                  onClick={() => {
                    onExportThread();
                    setShowMenu(false);
                  }}
                  className="w-full px-3 py-2.5 flex items-center gap-2.5 text-sm text-white/90 hover:bg-white/10 transition-colors text-left"
                >
                  <Download size={15} className="text-white/60" />
                  <span>Export chat</span>
                </button>
              )}

              {onTogglePrivateMode && (
                <button
                  onClick={() => {
                    onTogglePrivateMode();
                    setShowMenu(false);
                  }}
                  className="w-full px-3 py-2.5 flex items-center gap-2.5 text-sm text-white/90 hover:bg-white/10 transition-colors text-left"
                >
                  <EyeOff size={15} className="text-white/60" />
                  <span>{privateMode ? 'Disable' : 'Enable'} private mode</span>
                </button>
              )}

              <div className="h-px bg-white/10 my-1" />

              <button
                onClick={handleOpenSettings}
                className="w-full px-3 py-2.5 flex items-center gap-2.5 text-sm text-white/90 hover:bg-white/10 transition-colors text-left"
              >
                <Settings size={15} className="text-white/60" />
                <span>Settings</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
