import React from 'react'
import { cn } from '../design/utils'

export interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  size?: 'sm' | 'md'
  className?: string
  id?: string
}

export const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  disabled = false,
  size = 'md',
  className,
  id,
}) => {
  const sizes = {
    sm: {
      track: 'w-9 h-5',
      knob: 'w-4 h-4',
      translate: 'translate-x-4',
    },
    md: {
      track: 'w-11 h-6',
      knob: 'w-5 h-5',
      translate: 'translate-x-5',
    },
  }

  const s = sizes[size]

  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        'relative inline-flex flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40',
        s.track,
        checked ? 'bg-white/90' : 'bg-white/15',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block rounded-full shadow-sm transition-transform duration-200 ease-in-out',
          s.knob,
          'absolute top-0.5 left-0.5',
          checked ? cn(s.translate, 'bg-mono-900') : 'translate-x-0 bg-mono-500'
        )}
      />
    </button>
  )
}

Toggle.displayName = 'Toggle'
