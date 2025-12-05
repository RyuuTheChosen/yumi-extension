import { defineConfig, devices } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * Playwright E2E Configuration for Yumi Extension
 *
 * Runs Chrome with the extension loaded for integration testing.
 * See https://playwright.dev/docs/chrome-extensions
 */

// ES module equivalent of __dirname
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Path to the built extension
const extensionPath = path.join(__dirname, 'dist')

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Extensions require serial execution
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for extension tests
  reporter: 'html',
  timeout: 30000,

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium-extension',
      use: {
        ...devices['Desktop Chrome'],
        // Launch Chrome with extension loaded
        launchOptions: {
          args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
            '--no-first-run',
            '--disable-popup-blocking',
          ],
        },
      },
    },
  ],

  // Build extension before running tests
  webServer: {
    command: 'npm run build',
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
  },
})
