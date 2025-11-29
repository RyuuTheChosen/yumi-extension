/**
 * Vision Trigger Detection
 *
 * Detects when the user wants Yumi to "look at" or "see" the page,
 * which triggers a screenshot capture instead of just DOM extraction.
 */

/**
 * Keywords that indicate user wants visual analysis
 */
const VISION_TRIGGERS = [
  // Direct vision requests
  'look at this',
  'look at the',
  'look at my',
  'can you see',
  'what do you see',
  'show me',
  'take a look',
  'check this out',
  'see this',
  'see what',
  'look here',

  // Screenshot-specific
  'screenshot',
  'screen',
  'what\'s on my screen',
  'what am i looking at',
  'what is this showing',

  // Visual analysis
  'the image',
  'the picture',
  'the photo',
  'the chart',
  'the graph',
  'the diagram',
  'the layout',
  'the design',
  'the ui',
  'the interface',
]

/**
 * Check if the query requests visual/screenshot analysis
 */
export function isVisionQuery(query: string): boolean {
  const lower = query.toLowerCase()
  return VISION_TRIGGERS.some(trigger => lower.includes(trigger))
}

/**
 * Get the type of vision request
 */
export function getVisionType(query: string): 'screenshot' | 'none' {
  if (isVisionQuery(query)) {
    return 'screenshot'
  }
  return 'none'
}
