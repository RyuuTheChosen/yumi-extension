/**
 * Global chat overlay state tracker
 * Allows other modules to check if the chat overlay is currently open
 */

let isChatOpen = false

export function setChatOpen(open: boolean) {
  isChatOpen = open
}

export function isChatOverlayOpen(): boolean {
  return isChatOpen
}
