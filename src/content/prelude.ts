// Prelude script - Runs FIRST before Cubism SDK loads
// Configures Module.locateFile to tell Emscripten where to find WASM files

import { createLogger } from '../lib/debug'

const log = createLogger('Prelude')

declare global {
  interface Window {
    Module?: {
      locateFile?: (path: string) => string
    }
  }
}

// Initialize Module object if it doesn't exist
if (!window.Module) {
  window.Module = {}
}

// Configure WASM file path resolution
// This runs BEFORE live2dcubismcore.min.js loads
window.Module.locateFile = (path: string) => {
  const url = chrome.runtime.getURL('cubism-sdk/' + path)
  log.log('Module.locateFile:', path, '→', url)
  return url
}

log.log('Module.locateFile configured for WASM')

// Export to make it a valid ES module
export {}
