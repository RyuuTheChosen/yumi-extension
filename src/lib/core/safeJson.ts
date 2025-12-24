/**
 * Safe JSON parsing utilities
 *
 * Provides type-safe JSON parsing with fallback values to prevent
 * runtime crashes from corrupted or unexpected storage data.
 */

/**
 * Safely parse JSON with a fallback value.
 * Returns the fallback if parsing fails or the result is null/undefined.
 *
 * @param json - The JSON string to parse
 * @param fallback - The value to return if parsing fails
 * @returns The parsed value or the fallback
 */
export function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (json == null) return fallback

  try {
    const result = JSON.parse(json) as T
    return result ?? fallback
  } catch {
    return fallback
  }
}

/**
 * Safely parse JSON and extract a specific property.
 * Useful for extracting state from Zustand persisted stores.
 *
 * @param json - The JSON string to parse
 * @param path - Dot-separated path to the property (e.g., 'state.settings')
 * @param fallback - The value to return if extraction fails
 * @returns The extracted value or the fallback
 */
export function safeJsonExtract<T>(
  json: string | null | undefined,
  path: string,
  fallback: T
): T {
  if (json == null) return fallback

  try {
    const parsed = JSON.parse(json)
    const keys = path.split('.')
    let result: unknown = parsed

    for (const key of keys) {
      if (result == null || typeof result !== 'object') {
        return fallback
      }
      result = (result as Record<string, unknown>)[key]
    }

    return (result as T) ?? fallback
  } catch {
    return fallback
  }
}
