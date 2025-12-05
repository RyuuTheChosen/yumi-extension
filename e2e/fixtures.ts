import { test as base, chromium, type BrowserContext } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * E2E Test Fixtures
 *
 * Provides a browser context with the Yumi extension loaded.
 */

// ES module equivalent of __dirname
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Path to the built extension
const extensionPath = path.join(__dirname, '..', 'dist')

// Extension ID is deterministic based on the path when unpacked
// Note: In production, you might want to compute this dynamically

export type TestFixtures = {
  context: BrowserContext
  extensionId: string
}

export const test = base.extend<TestFixtures>({
  // Override context to load extension
  context: async ({ }, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false, // Extensions require headed mode
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
        '--disable-popup-blocking',
      ],
    })

    await use(context)
    await context.close()
  },

  // Get extension ID from service worker
  extensionId: async ({ context }, use) => {
    // Wait for service worker to register
    let extensionId = ''

    // Get extension ID from service workers
    const serviceWorkers = context.serviceWorkers()
    if (serviceWorkers.length > 0) {
      const url = serviceWorkers[0].url()
      const match = url.match(/chrome-extension:\/\/([^/]+)/)
      if (match) {
        extensionId = match[1]
      }
    }

    // If no service worker yet, wait for it
    if (!extensionId) {
      const sw = await context.waitForEvent('serviceworker')
      const match = sw.url().match(/chrome-extension:\/\/([^/]+)/)
      if (match) {
        extensionId = match[1]
      }
    }

    await use(extensionId)
  },
})

export { expect } from '@playwright/test'

/**
 * Helper to wait for extension to fully initialize
 */
export async function waitForExtensionReady(context: BrowserContext, timeout = 10000) {
  const page = await context.newPage()

  // Navigate to a test page
  await page.goto('https://example.com')

  // Wait for content script to inject the overlay container
  await page.waitForSelector('#yumi-overlay-root', { timeout })

  return page
}

/**
 * Helper to open extension popup
 */
export async function openPopup(context: BrowserContext, extensionId: string) {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/popup/index.html`)
  return page
}
