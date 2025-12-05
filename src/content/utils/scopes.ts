/**
 * Scope System for Conversation Threading
 *
 * Enables per-origin conversation isolation (gmail.com ≠ github.com)
 * while supporting global cross-site threads when needed.
 */

import { createLogger } from '../../lib/debug'

const log = createLogger('Scopes')

export type ScopeMode = 'origin' | 'global' | 'manual'

export interface Scope {
  mode: ScopeMode
  origin?: string        // 'gmail.com'
  pathKey?: string       // 'gmail.com/mail'
  name?: string          // Display name
  id: string             // Unique identifier (used as thread key)
}

/**
 * Create a scope based on current page origin
 */
export function createOriginScope(): Scope {
  try {
    const url = new URL(window.location.href)
    const origin = url.hostname
    const pathKey = url.pathname.split('/')[1] || ''
    
    return {
      mode: 'origin',
      origin,
      pathKey: `${origin}/${pathKey}`,
      id: `origin:${origin}`,
      name: origin
    }
  } catch (err) {
    log.warn('Failed to create origin scope:', err)
    return createGlobalScope()
  }
}

/**
 * Create the global (cross-site) scope
 */
export function createGlobalScope(): Scope {
  return {
    mode: 'global',
    id: 'global',
    name: 'Global Conversation'
  }
}

/**
 * Create a custom manual scope
 */
export function createManualScope(name: string, id?: string): Scope {
  return {
    mode: 'manual',
    id: id || `manual:${crypto.randomUUID()}`,
    name
  }
}

/**
 * Get current active scope from session storage or default to origin
 */
export function getCurrentScope(): Scope {
  try {
    const stored = sessionStorage.getItem('yumi-active-scope')
    if (stored) {
      const parsed = JSON.parse(stored)
      // Validate structure
      if (parsed?.id && parsed?.mode) {
        return parsed as Scope
      }
    }
  } catch (err) {
    log.warn('Failed to load active scope:', err)
  }
  
  // Default to origin scope
  return createOriginScope()
}

/**
 * Save active scope to session storage
 */
export function setCurrentScope(scope: Scope): void {
  try {
    sessionStorage.setItem('yumi-active-scope', JSON.stringify(scope))
  } catch (err) {
    log.warn('Failed to save active scope:', err)
  }
}

/**
 * Format scope for display
 */
export function formatScopeName(scope: Scope): string {
  if (scope.name) return scope.name
  if (scope.origin) return scope.origin
  return 'Unknown'
}
