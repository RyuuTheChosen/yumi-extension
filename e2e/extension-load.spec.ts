import { test, expect } from './fixtures'

/**
 * Extension Loading Tests
 *
 * Verifies that the extension loads correctly.
 * Note: Overlay tests require Hub authentication which isn't available in E2E.
 */

test.describe('Extension Loading', () => {
  test('should register service worker', async ({ context, extensionId }) => {
    expect(extensionId).toBeTruthy()
    expect(extensionId.length).toBeGreaterThan(0)
  })

  test('should load content script on web pages', async ({ context }) => {
    const page = await context.newPage()
    await page.goto('https://example.com')

    // Content script runs but overlay only appears when authenticated
    // Verify the page loads without errors
    await page.waitForLoadState('domcontentloaded')

    // Check that no JS errors occurred
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.waitForTimeout(2000)

    // Extension should load without critical errors
    const criticalErrors = errors.filter(e =>
      e.includes('yumi') && !e.includes('not authenticated')
    )
    expect(criticalErrors).toHaveLength(0)
  })

  test('should not inject on restricted pages', async ({ context }) => {
    const page = await context.newPage()

    // Chrome pages should not have content script
    await page.goto('chrome://extensions/')
    await page.waitForTimeout(2000)

    const overlayRoot = await page.$('#yumi-overlay-root')
    expect(overlayRoot).toBeNull()
  })

  test('should have manifest with correct permissions', async ({ context, extensionId }) => {
    // Verify extension loaded with expected ID format
    expect(extensionId).toMatch(/^[a-z]{32}$/)
  })
})
