/**
 * Conditional logging utility that respects build mode.
 * Logs are only output in development builds when __DEV__ is true.
 * Errors are always logged regardless of build mode.
 */

declare const __DEV__: boolean

export const DEBUG = {
  enabled: typeof __DEV__ !== 'undefined' ? __DEV__ : false,
}

type LogFn = (...args: unknown[]) => void

interface Logger {
  log: LogFn
  warn: LogFn
  error: LogFn
  info: LogFn
}

/**
 * Creates a namespaced logger that conditionally outputs based on build mode.
 *
 * @param namespace - Prefix for log messages (e.g., 'ChatOverlay', 'Memory')
 * @returns Logger object with log, warn, error, and info methods
 *
 * @example
 * const log = createLogger('ChatOverlay')
 * log.log('Initialized') // [ChatOverlay] Initialized (dev only)
 * log.error('Failed', err) // [ChatOverlay] Failed (always)
 */
export function createLogger(namespace: string): Logger {
  const prefix = `[${namespace}]`

  return {
    log: (...args: unknown[]) => {
      if (DEBUG.enabled) console.log(prefix, ...args)
    },
    warn: (...args: unknown[]) => {
      if (DEBUG.enabled) console.warn(prefix, ...args)
    },
    error: (...args: unknown[]) => {
      // Errors always logged regardless of build mode
      console.error(prefix, ...args)
    },
    info: (...args: unknown[]) => {
      if (DEBUG.enabled) console.info(prefix, ...args)
    },
  }
}
