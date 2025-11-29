/**
 * Yumi Design System - Color Palette
 * Glass Frosted Monochrome Theme
 */

export const colors = {
  // Monochrome scale - Pure black to white
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

  // Glass colors - For transparent elements
  glass: {
    // Light glass (for overlays on any background)
    panel: 'rgba(255, 255, 255, 0.15)',
    panelHover: 'rgba(255, 255, 255, 0.20)',
    panelStrong: 'rgba(255, 255, 255, 0.25)',

    // Dark glass (for settings panel)
    dark: 'rgba(20, 20, 20, 0.80)',
    darkHover: 'rgba(20, 20, 20, 0.85)',
    darkStrong: 'rgba(20, 20, 20, 0.90)',

    // Bubbles
    bubbleAi: 'rgba(255, 255, 255, 0.25)',
    bubbleUser: 'rgba(0, 0, 0, 0.60)',

    // Input
    input: 'rgba(255, 255, 255, 0.15)',
    inputFocus: 'rgba(255, 255, 255, 0.25)',

    // Borders
    border: 'rgba(255, 255, 255, 0.15)',
    borderSubtle: 'rgba(255, 255, 255, 0.08)',
    borderStrong: 'rgba(255, 255, 255, 0.25)',
    borderFocus: 'rgba(255, 255, 255, 0.40)',
  },

  // Text colors on glass
  text: {
    primary: '#ffffff',
    secondary: 'rgba(255, 255, 255, 0.70)',
    muted: 'rgba(255, 255, 255, 0.50)',
    disabled: 'rgba(255, 255, 255, 0.30)',
    inverse: '#1a1a1a',
  },

  // Button colors
  button: {
    primary: 'rgba(255, 255, 255, 0.90)',
    primaryHover: '#ffffff',
    primaryText: '#1a1a1a',
    secondary: 'rgba(255, 255, 255, 0.15)',
    secondaryHover: 'rgba(255, 255, 255, 0.25)',
    secondaryText: '#ffffff',
    ghost: 'transparent',
    ghostHover: 'rgba(255, 255, 255, 0.10)',
  },

  // Semantic colors (subtle versions for glass UI)
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

  // Status indicators
  status: {
    online: '#22c55e',
    offline: '#6b7280',
    busy: '#f59e0b',
  },
} as const;

export type ColorPalette = typeof colors;
