/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx,html}'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Monochrome scale
        mono: {
          white: '#ffffff',
          50: '#fafafa',
          100: '#f5f5f5',
          200: '#e5e5e5',
          300: '#d4d4d4',
          400: '#a3a3a3',
          500: '#737373',
          600: '#525252',
          700: '#404040',
          800: '#262626',
          900: '#171717',
          950: '#0a0a0a',
          black: '#000000',
        },
        // Glass-specific colors
        glass: {
          panel: 'rgba(255, 255, 255, 0.15)',
          'panel-hover': 'rgba(255, 255, 255, 0.20)',
          'panel-strong': 'rgba(255, 255, 255, 0.25)',
          dark: 'rgba(20, 20, 20, 0.80)',
          'dark-hover': 'rgba(20, 20, 20, 0.85)',
          'bubble-ai': 'rgba(255, 255, 255, 0.25)',
          'bubble-user': 'rgba(0, 0, 0, 0.60)',
          input: 'rgba(255, 255, 255, 0.15)',
          'input-focus': 'rgba(255, 255, 255, 0.25)',
          border: 'rgba(255, 255, 255, 0.15)',
          'border-subtle': 'rgba(255, 255, 255, 0.08)',
          'border-strong': 'rgba(255, 255, 255, 0.25)',
          'border-focus': 'rgba(255, 255, 255, 0.40)',
        },
        // Semantic colors
        success: {
          light: 'rgba(34, 197, 94, 0.20)',
          DEFAULT: '#22c55e',
          dark: '#16a34a',
        },
        warning: {
          light: 'rgba(245, 158, 11, 0.20)',
          DEFAULT: '#f59e0b',
          dark: '#d97706',
        },
        error: {
          light: 'rgba(239, 68, 68, 0.20)',
          DEFAULT: '#ef4444',
          dark: '#dc2626',
        },
        info: {
          light: 'rgba(59, 130, 246, 0.20)',
          DEFAULT: '#3b82f6',
          dark: '#2563eb',
        },
        // Status
        status: {
          online: '#22c55e',
          offline: '#6b7280',
          busy: '#f59e0b',
        },
      },
      // Backdrop blur utilities
      backdropBlur: {
        xs: '2px',
        sm: '4px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        '2xl': '24px',
        '3xl': '40px',
      },
      fontFamily: {
        sans: [
          '"Inter"',
          '"Quicksand"',
          '"Nunito"',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
          '"Segoe UI Symbol"'
        ],
        display: [
          '"Fredoka"',
          '"Quicksand"',
          '"Comfortaa"',
          '"Nunito"',
          'system-ui',
          'sans-serif'
        ],
        mono: [
          '"JetBrains Mono"',
          '"Fira Code"',
          '"Cascadia Code"',
          'Menlo',
          'Monaco',
          'Consolas',
          '"Courier New"',
          'monospace'
        ],
        cute: [
          '"Comic Neue"',
          '"Comic Sans MS"',
          '"Chalkboard SE"',
          '"Arial Rounded MT Bold"',
          'cursive'
        ]
      },
      fontSize: {
        'xs': ['0.75rem', { lineHeight: '1rem', letterSpacing: '0.025em' }],
        'sm': ['0.875rem', { lineHeight: '1.25rem', letterSpacing: '0.01em' }],
        'base': ['1rem', { lineHeight: '1.5rem', letterSpacing: '0' }],
        'lg': ['1.125rem', { lineHeight: '1.75rem', letterSpacing: '-0.01em' }],
        'xl': ['1.25rem', { lineHeight: '1.75rem', letterSpacing: '-0.01em' }],
        '2xl': ['1.5rem', { lineHeight: '2rem', letterSpacing: '-0.02em' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem', letterSpacing: '-0.02em' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem', letterSpacing: '-0.03em' }],
        '5xl': ['3rem', { lineHeight: '1', letterSpacing: '-0.03em' }],
      },
      fontWeight: {
        thin: '100',
        extralight: '200',
        light: '300',
        normal: '400',
        medium: '500',
        semibold: '600',
        bold: '700',
        extrabold: '800',
        black: '900',
      },
      animation: {
        'fade-in': 'fadeIn 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        'fade-in-fast': 'fadeIn 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'slide-down': 'slideDown 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'slide-in-right': 'slideInRight 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'slide-in-left': 'slideInLeft 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'scale-in': 'scaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'bounce-in': 'bounceIn 0.7s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
        'wiggle': 'wiggle 0.6s cubic-bezier(0.36, 0.07, 0.19, 0.97)',
        'sparkle': 'sparkle 1.5s ease-in-out infinite',
        'sparkle-slow': 'sparkle 2.5s ease-in-out infinite',
        'glow-pulse': 'glowPulse 2.5s ease-in-out infinite',
        'glow-pulse-strong': 'glowPulseStrong 2s ease-in-out infinite',
        'float': 'float 3.5s ease-in-out infinite',
        'float-slow': 'float 5s ease-in-out infinite',
        'shake': 'shake 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97)',
        'spin-slow': 'spin 3s linear infinite',
        'ping-slow': 'ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
        'pulse-soft': 'pulseSoft 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      transitionTimingFunction: {
        'in-expo': 'cubic-bezier(0.95, 0.05, 0.795, 0.035)',
        'out-expo': 'cubic-bezier(0.19, 1, 0.22, 1)',
        'smooth': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'bounce-in': 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
        'bounce-out': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      boxShadow: {
        'soft-xs': '0 1px 2px 0 rgba(0, 0, 0, 0.03)',
        'soft-sm': '0 2px 4px 0 rgba(0, 0, 0, 0.04)',
        'soft-md': '0 4px 8px 0 rgba(0, 0, 0, 0.05)',
        'soft-lg': '0 8px 16px 0 rgba(0, 0, 0, 0.06)',
        'soft-xl': '0 12px 24px 0 rgba(0, 0, 0, 0.07)',
        'glass': '0 2px 8px rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(255, 255, 255, 0.1)',
        'glass-lg': '0 4px 12px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(255, 255, 255, 0.1)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(20px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        slideInLeft: {
          '0%': { transform: 'translateX(-20px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        bounceIn: {
          '0%': { transform: 'scale(0.3)', opacity: '0' },
          '50%': { transform: 'scale(1.05)', opacity: '1' },
          '70%': { transform: 'scale(0.97)' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        wiggle: {
          '0%, 100%': { transform: 'rotate(-4deg)' },
          '50%': { transform: 'rotate(4deg)' },
        },
        sparkle: {
          '0%, 100%': { opacity: '1', transform: 'scale(1) rotate(0deg)' },
          '50%': { opacity: '0.4', transform: 'scale(1.3) rotate(180deg)' },
        },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 15px rgba(232, 139, 125, 0.3), 0 0 30px rgba(152, 217, 194, 0.15)' },
          '50%': { boxShadow: '0 0 25px rgba(232, 139, 125, 0.5), 0 0 45px rgba(152, 217, 194, 0.25)' },
        },
        glowPulseStrong: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(232, 139, 125, 0.5), 0 0 40px rgba(152, 217, 194, 0.3)' },
          '50%': { boxShadow: '0 0 35px rgba(232, 139, 125, 0.7), 0 0 60px rgba(152, 217, 194, 0.4)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-12px)' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '10%, 30%, 50%, 70%, 90%': { transform: 'translateX(-6px)' },
          '20%, 40%, 60%, 80%': { transform: 'translateX(6px)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
      },
    }
  },
  plugins: []
}
