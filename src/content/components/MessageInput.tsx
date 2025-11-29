/**
 * MessageInput Component
 * Clean auto-resize textarea with send button
 */

import { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';
import { cn } from '../../lib/design/utils';

interface MessageInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

export function MessageInput({ onSend, disabled = false }: MessageInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }, [input]);

  const handleSubmit = () => {
    if (!input.trim() || disabled) return;

    onSend(input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const charCount = input.length;
  const maxChars = 2000;
  const isOverLimit = charCount > maxChars;
  const canSend = input.trim() && !isOverLimit && !disabled;

  return (
    <div
      className="p-2"
      style={{
        borderTop: '1px solid rgba(255, 255, 255, 0.10)',
        background: 'rgba(0, 0, 0, 0.20)'
      }}
    >
      <div className="flex items-end gap-2">
        {/* Textarea */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Yumi..."
            rows={1}
            maxLength={maxChars}
            className={cn(
              'w-full resize-none rounded-lg px-3 py-2 text-sm',
              'glass-input focus:outline-none',
              'transition-colors duration-150',
              'text-white placeholder:text-white/40',
              isOverLimit && 'border-error/50 bg-error/10'
            )}
            disabled={disabled}
          />

          {/* Character count - only show when near limit */}
          {charCount > maxChars * 0.8 && (
            <span
              className={cn(
                'absolute bottom-2 right-3 text-[10px]',
                isOverLimit ? 'text-error' : 'text-white/40'
              )}
            >
              {charCount}/{maxChars}
            </span>
          )}
        </div>

        {/* Send Button */}
        <button
          onClick={handleSubmit}
          disabled={!canSend}
          className={cn(
            'flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-150 flex-shrink-0',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40',
            canSend
              ? 'glass-btn-primary active:scale-95'
              : 'bg-white/10 text-white/30 cursor-not-allowed'
          )}
          aria-label="Send message"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
