import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Send, Mic, Loader2, Globe } from 'lucide-react';
import { cn } from '../../lib/design/utils';
import { sttService } from '../../lib/stt/sttService';
import type { STTState, STTEvent } from '../../lib/stt/types';
import { createLogger } from '../../lib/core/debug';

const log = createLogger('MessageInput');

/** Search toggle props for web search functionality */
export interface SearchProps {
  available: boolean;
  active: boolean;
  isSearching: boolean;
  onToggle: () => void;
}

interface MessageInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
  sttEnabled?: boolean;
  hubUrl?: string;
  hubAccessToken?: string | null;
  onProactiveEngaged?: () => void;
  searchProps?: SearchProps;
}

export interface MessageInputHandle {
  appendText: (text: string) => void;
}

export const MessageInput = forwardRef<MessageInputHandle, MessageInputProps>(function MessageInput({
  onSend,
  disabled = false,
  placeholder = 'Message Yumi...',
  sttEnabled = false,
  hubUrl,
  hubAccessToken,
  onProactiveEngaged,
  searchProps,
}, ref) {
  const [input, setInput] = useState('');
  const [sttState, setSTTState] = useState<STTState>('idle');
  const [recordingDuration, setRecordingDuration] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useImperativeHandle(ref, () => ({
    appendText: (text: string) => {
      setInput((prev) => prev + (prev ? ' ' : '') + text);
    },
  }), []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }, [input]);

  useEffect(() => {
    if (!sttEnabled || !hubUrl || !hubAccessToken) return;

    sttService.initialize(hubUrl, hubAccessToken, { enabled: true });

    const unsubscribe = sttService.on((event: STTEvent) => {
      switch (event.type) {
        case 'recording:start':
          setSTTState('recording');
          setRecordingDuration(0);
          durationIntervalRef.current = setInterval(() => {
            setRecordingDuration(sttService.getRecordingDuration());
          }, 100);
          break;
        case 'recording:stop':
          if (durationIntervalRef.current) {
            clearInterval(durationIntervalRef.current);
            durationIntervalRef.current = null;
          }
          break;
        case 'transcription:start':
          setSTTState('transcribing');
          break;
        case 'transcription:complete':
          setSTTState('idle');
          setRecordingDuration(0);
          if (event.text) {
            setInput((prev) => prev + (prev ? ' ' : '') + event.text);
          }
          break;
        case 'transcription:error':
          setSTTState('idle');
          setRecordingDuration(0);
          log.error('STT error:', event.error);
          break;
      }
    });

    return () => {
      sttService.cancelRecording();
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
      unsubscribe();
    };
  }, [sttEnabled, hubUrl, hubAccessToken]);

  const handleMicMouseDown = async () => {
    if (!sttEnabled || !hubAccessToken || sttState !== 'idle') return;
    await sttService.startRecording();
  };

  const handleMicMouseUp = async () => {
    if (sttState !== 'recording') return;
    await sttService.stopRecordingAndTranscribe();
  };

  const handleMicCancel = () => {
    if (sttState === 'recording') {
      sttService.cancelRecording();
      setSTTState('idle');
      setRecordingDuration(0);
    }
  };

  const handleSubmit = () => {
    if (!input.trim() || disabled) return;

    onSend(input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const stopPropagation = (e: React.KeyboardEvent | React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const charCount = input.length;
  const maxChars = 2000;
  const isOverLimit = charCount > maxChars;
  const canSend = input.trim() && !isOverLimit && !disabled;

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    return `${seconds}s`;
  };

  return (
    <div
      className="p-2"
      style={{
        borderTop: '1px solid rgba(255, 255, 255, 0.10)',
        background: 'rgba(0, 0, 0, 0.20)'
      }}
    >
      <div className="flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onKeyUp={stopPropagation}
            onKeyPress={stopPropagation}
            placeholder={placeholder}
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

        {sttEnabled && hubAccessToken && (
          <button
            onMouseDown={handleMicMouseDown}
            onMouseUp={handleMicMouseUp}
            onMouseLeave={handleMicCancel}
            onTouchStart={handleMicMouseDown}
            onTouchEnd={handleMicMouseUp}
            onTouchCancel={handleMicCancel}
            onContextMenu={(e) => e.preventDefault()}
            disabled={disabled || sttState === 'transcribing'}
            className={cn(
              'flex items-center justify-center min-w-9 h-9 px-2 rounded-lg transition-all duration-150 flex-shrink-0',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40',
              sttState === 'recording'
                ? 'bg-red-500/80 text-white animate-pulse'
                : sttState === 'transcribing'
                  ? 'bg-white/20 text-white/50 cursor-wait'
                  : 'bg-white/10 hover:bg-white/20 text-white/70'
            )}
            aria-label={
              sttState === 'recording'
                ? 'Recording... Release to transcribe'
                : sttState === 'transcribing'
                  ? 'Transcribing...'
                  : 'Hold to record'
            }
            title="Hold to record, release to transcribe"
          >
            {sttState === 'transcribing' ? (
              <Loader2 size={16} className="animate-spin" />
            ) : sttState === 'recording' ? (
              <span className="flex items-center gap-1">
                <Mic size={16} />
                <span className="text-xs font-medium">{formatDuration(recordingDuration)}</span>
              </span>
            ) : (
              <Mic size={16} />
            )}
          </button>
        )}

        {searchProps?.available && (
          <button
            onClick={searchProps.onToggle}
            disabled={disabled || searchProps.isSearching}
            className={cn(
              'flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-150 flex-shrink-0',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40',
              searchProps.isSearching
                ? 'bg-blue-500/20 text-blue-400 cursor-wait'
                : searchProps.active
                  ? 'bg-blue-500/30 text-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.3)]'
                  : 'bg-white/10 hover:bg-white/20 text-white/50'
            )}
            aria-label={searchProps.active ? 'Web search enabled' : 'Enable web search'}
            title={searchProps.active ? 'Web search enabled - click to disable' : 'Search web with this message'}
          >
            {searchProps.isSearching ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Globe size={16} />
            )}
          </button>
        )}

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
})
