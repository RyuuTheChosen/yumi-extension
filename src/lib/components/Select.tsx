import React from 'react'
import { cn } from '../design/utils'
import { ChevronDown } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  options: SelectOption[]
  onChange?: (value: string) => void
  error?: boolean
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, onChange, error, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            'w-full px-4 py-2.5 pr-10 rounded-[10px] text-sm appearance-none cursor-pointer',
            'bg-white/15 border border-white/20 text-white',
            'focus:outline-none focus:bg-white/25 focus:border-white/40',
            'transition-all duration-200',
            error && 'border-error/50 focus:border-error',
            className
          )}
          onChange={(e) => onChange?.(e.target.value)}
          {...props}
        >
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              className="bg-mono-900 text-white"
            >
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/60 pointer-events-none" />
      </div>
    )
  }
)

Select.displayName = 'Select'
