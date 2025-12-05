/**
 * Performance Monitoring for Yumi Extension
 *
 * Tracks render times, memory usage, and performance metrics.
 * Logs warnings when thresholds are exceeded.
 */

import { createLogger } from '../debug'

const log = createLogger('Performance')

// Performance thresholds
export const PERFORMANCE_THRESHOLDS = {
  renderTime: 100,      // ms - warn if component takes > 100ms
  memoryUsage: 100,     // MB - warn if heap > 100MB
  memoryGrowth: 20,     // MB/min - warn if growing > 20MB/min
  apiLatency: 5000,     // ms - warn if API > 5s
} as const

// Memory tracking state
let lastMemoryCheck = 0
let lastMemoryUsage = 0

/**
 * Measure component render time
 *
 * @example
 * const measure = measureRenderTime('ChatOverlay')
 * const end = measure.start()
 * // ... render logic
 * end()
 */
export function measureRenderTime(componentName: string) {
  return {
    start: () => {
      const startTime = performance.now()
      return () => {
        const duration = performance.now() - startTime
        if (duration > PERFORMANCE_THRESHOLDS.renderTime) {
          log.warn(`Slow render: ${componentName} took ${duration.toFixed(2)}ms`)
        }
        return duration
      }
    }
  }
}

/**
 * Measure async operation duration
 *
 * @example
 * const duration = await measureAsync('API call', async () => {
 *   return await fetchData()
 * })
 */
export async function measureAsync<T>(
  operationName: string,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = performance.now()
  try {
    return await fn()
  } finally {
    const duration = performance.now() - startTime
    if (duration > PERFORMANCE_THRESHOLDS.apiLatency) {
      log.warn(`Slow operation: ${operationName} took ${duration.toFixed(2)}ms`)
    }
  }
}

/**
 * Get current memory usage in MB
 * Note: Only available in Chrome with certain flags
 */
export function getMemoryUsage(): number | null {
  if ('memory' in performance) {
    const mem = (performance as Performance & { memory?: {
      usedJSHeapSize: number
      totalJSHeapSize: number
    } }).memory
    if (mem) {
      return mem.usedJSHeapSize / 1024 / 1024
    }
  }
  return null
}

/**
 * Track memory usage and detect potential leaks
 */
export function trackMemoryUsage(): void {
  const currentUsage = getMemoryUsage()
  if (currentUsage === null) return

  const now = Date.now()

  // Check absolute usage
  if (currentUsage > PERFORMANCE_THRESHOLDS.memoryUsage) {
    log.warn(`High memory usage: ${currentUsage.toFixed(2)}MB (threshold: ${PERFORMANCE_THRESHOLDS.memoryUsage}MB)`)
  }

  // Check growth rate (only if we have previous measurement)
  if (lastMemoryCheck > 0 && lastMemoryUsage > 0) {
    const timeDelta = (now - lastMemoryCheck) / 1000 / 60 // minutes
    const memoryDelta = currentUsage - lastMemoryUsage // MB
    const growthRate = memoryDelta / timeDelta // MB/min

    if (growthRate > PERFORMANCE_THRESHOLDS.memoryGrowth) {
      log.error(`Potential memory leak: Growing at ${growthRate.toFixed(2)}MB/min`)
    }
  }

  lastMemoryCheck = now
  lastMemoryUsage = currentUsage
}

/**
 * Performance metrics snapshot
 */
export interface PerformanceMetrics {
  memoryUsageMB: number | null
  timestamp: number
}

/**
 * Get current performance metrics
 */
export function getPerformanceMetrics(): PerformanceMetrics {
  return {
    memoryUsageMB: getMemoryUsage(),
    timestamp: Date.now()
  }
}

/**
 * Start periodic performance monitoring
 * @param intervalMs Check interval in milliseconds (default: 30s)
 * @returns Cleanup function to stop monitoring
 */
export function startPerformanceMonitoring(intervalMs = 30000): () => void {
  log.log('Starting performance monitoring')

  const intervalId = setInterval(() => {
    trackMemoryUsage()
  }, intervalMs)

  // Initial check
  trackMemoryUsage()

  return () => {
    clearInterval(intervalId)
    log.log('Stopped performance monitoring')
  }
}

/**
 * Create a performance mark for profiling
 */
export function mark(name: string): void {
  try {
    performance.mark(`yumi-${name}`)
  } catch {
    // Ignore if performance API not available
  }
}

/**
 * Measure between two marks
 */
export function measureBetween(startMark: string, endMark: string): number | null {
  try {
    performance.measure(`yumi-${startMark}-to-${endMark}`, `yumi-${startMark}`, `yumi-${endMark}`)
    const entries = performance.getEntriesByName(`yumi-${startMark}-to-${endMark}`)
    if (entries.length > 0) {
      return entries[entries.length - 1].duration
    }
  } catch {
    // Ignore if performance API not available
  }
  return null
}
