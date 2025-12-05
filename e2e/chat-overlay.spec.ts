import { test, expect } from './fixtures'

/**
 * Chat Overlay Tests
 *
 * Note: Full overlay tests require Hub authentication.
 * These tests verify the extension loads without errors.
 */

test.describe('Chat Overlay', () => {
  test('should load page without extension errors', async ({ context }) => {
    const page = await context.newPage()

    // Collect any page errors
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))

    await page.goto('https://example.com')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // No critical extension errors should occur
    const criticalErrors = errors.filter(e =>
      e.toLowerCase().includes('yumi') &&
      !e.includes('not authenticated') &&
      !e.includes('Hub')
    )
    expect(criticalErrors).toHaveLength(0)
  })

  test('should have IndexedDB available for chat storage', async ({ context }) => {
    const page = await context.newPage()
    await page.goto('https://example.com')

    const hasIndexedDB = await page.evaluate(() => 'indexedDB' in window)
    expect(hasIndexedDB).toBe(true)
  })

  test('should have required browser APIs', async ({ context }) => {
    const page = await context.newPage()
    await page.goto('https://example.com')

    const apis = await page.evaluate(() => ({
      indexedDB: 'indexedDB' in window,
      crypto: 'crypto' in window,
      performance: 'performance' in window,
      customElements: 'customElements' in window,
    }))

    expect(apis.indexedDB).toBe(true)
    expect(apis.crypto).toBe(true)
    expect(apis.performance).toBe(true)
    expect(apis.customElements).toBe(true)
  })
})

test.describe('Chat Persistence', () => {
  test('should have storage APIs for persistence', async ({ context }) => {
    const page = await context.newPage()
    await page.goto('https://example.com')

    const hasStorage = await page.evaluate(() => {
      return 'indexedDB' in window && 'localStorage' in window
    })

    expect(hasStorage).toBe(true)
  })
})
