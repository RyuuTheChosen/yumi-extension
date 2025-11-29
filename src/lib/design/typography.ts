/**
 * Yumi Design System - Typography
 * Font families, sizes, weights, and line heights
 */

export const typography = {
  fonts: {
    sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: 'JetBrains Mono, Menlo, Monaco, "Courier New", monospace',
  },
  
  sizes: {
    xs: '0.75rem',      // 12px - metadata, timestamps
    sm: '0.875rem',     // 14px - body text, labels
    base: '1rem',       // 16px - default message text
    lg: '1.125rem',     // 18px - headings, emphasis
    xl: '1.25rem',      // 20px - page titles
    '2xl': '1.5rem',    // 24px - hero text
  },
  
  weights: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  
  lineHeights: {
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.75,
  }
} as const;

export type Typography = typeof typography;
