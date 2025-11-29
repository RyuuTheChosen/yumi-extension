import React from 'react'
import { cn } from '../design/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          'w-full px-4 py-2.5 rounded-[10px] text-sm',
          'glass-input',
          'placeholder:text-white/50',
          'focus:outline-none',
          error && 'border-error/50 focus:border-error',
          className
        )}
        {...props}
      />
    )
  }
)

Input.displayName = 'Input'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          'w-full px-4 py-2.5 rounded-[10px] text-sm resize-none',
          'glass-input',
          'placeholder:text-white/50',
          'focus:outline-none',
          error && 'border-error/50 focus:border-error',
          className
        )}
        {...props}
      />
    )
  }
)

Textarea.displayName = 'Textarea'
