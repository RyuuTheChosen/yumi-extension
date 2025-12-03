/**
 * Yumi Web Search Trigger Detection
 *
 * Analyzes user messages to determine if a web search would be helpful.
 * Uses keyword patterns to detect queries about current events, real-time data, etc.
 */

/**
 * Patterns that suggest the user wants current/fresh information.
 */
const FRESHNESS_PATTERNS = [
  /\b(today|yesterday|this week|this month|this year)\b/i,
  /\b(latest|recent|current|now|new|newest|updated)\b/i,
  /\b(2024|2025|2026)\b/, // Current/near years
]

/**
 * Patterns that suggest news or events queries.
 */
const NEWS_PATTERNS = [
  /\b(news|happened|announced|released|launched|update)\b/i,
  /\b(breaking|trending|viral|popular)\b/i,
  /\b(event|conference|summit|election)\b/i,
]

/**
 * Patterns that suggest real-time data queries.
 */
const REALTIME_PATTERNS = [
  /\b(price|stock|crypto|bitcoin|eth|currency)\b/i,
  /\b(weather|forecast|temperature)\b/i,
  /\b(score|game|match|result)\b/i,
  /\b(status|availability|open|closed)\b/i,
]

/**
 * Patterns that explicitly request search.
 */
const EXPLICIT_PATTERNS = [
  /\b(search|look up|find out|google|research)\b/i,
  /\b(what is the|who is the|where is the)\b/i,
  /\b(can you find|can you search|can you look)\b/i,
]

/**
 * Patterns that suggest the user is asking about something
 * that might benefit from web search.
 */
const KNOWLEDGE_PATTERNS = [
  /\b(how do i|how to|how can i)\b/i,
  /\b(what are the|what is a|what does)\b/i,
  /\b(who is|who are|who was)\b/i,
  /\b(when did|when will|when is)\b/i,
  /\b(where can|where is|where are)\b/i,
]

/**
 * Patterns that suggest the query is about coding/development
 * where search is less likely needed.
 */
const CODE_PATTERNS = [
  /```/,
  /\b(function|const|let|var|class|import|export)\b/,
  /\b(error|bug|fix|debug|code|script)\b/i,
  /\b(typescript|javascript|python|react|vue|node)\b/i,
]

/**
 * Check if a message should trigger a web search suggestion.
 * Returns a confidence score (0-1) and reason.
 */
export function analyzeSearchNeed(message: string): {
  shouldSearch: boolean
  confidence: number
  reason: string
} {
  const normalizedMessage = message.toLowerCase().trim()

  // Skip very short messages
  if (normalizedMessage.length < 10) {
    return { shouldSearch: false, confidence: 0, reason: 'Message too short' }
  }

  // Skip if it looks like code
  const codeMatchCount = CODE_PATTERNS.filter(p => p.test(message)).length
  if (codeMatchCount >= 2) {
    return { shouldSearch: false, confidence: 0.1, reason: 'Appears to be code-related' }
  }

  let score = 0
  const reasons: string[] = []

  // Check explicit search patterns (high weight)
  if (EXPLICIT_PATTERNS.some(p => p.test(message))) {
    score += 0.5
    reasons.push('explicit search request')
  }

  // Check freshness patterns
  if (FRESHNESS_PATTERNS.some(p => p.test(message))) {
    score += 0.3
    reasons.push('freshness indicator')
  }

  // Check news patterns
  if (NEWS_PATTERNS.some(p => p.test(message))) {
    score += 0.3
    reasons.push('news/events query')
  }

  // Check real-time data patterns
  if (REALTIME_PATTERNS.some(p => p.test(message))) {
    score += 0.4
    reasons.push('real-time data query')
  }

  // Check knowledge patterns (lower weight - might be answerable without search)
  if (KNOWLEDGE_PATTERNS.some(p => p.test(message))) {
    score += 0.15
    reasons.push('knowledge question')
  }

  // Cap at 1.0
  const confidence = Math.min(score, 1)

  // Threshold for suggesting search
  const shouldSearch = confidence >= 0.3

  return {
    shouldSearch,
    confidence,
    reason: reasons.length > 0 ? reasons.join(', ') : 'No search patterns detected',
  }
}

/**
 * Simple check if search should be suggested.
 */
export function shouldSuggestSearch(message: string): boolean {
  return analyzeSearchNeed(message).shouldSearch
}

/**
 * Extract a search query from the user message.
 * Tries to clean up the query for better search results.
 */
export function extractSearchQuery(message: string): string {
  let query = message.trim()

  // Remove common prefixes that aren't helpful for search
  const prefixPatterns = [
    /^(hey |hi |hello |yo |okay |ok )/i,
    /^(can you |could you |would you |please )/i,
    /^(search for |look up |find |google )/i,
    /^(tell me |show me |give me )/i,
    /^(what is |what are |what's )/i,
  ]

  for (const pattern of prefixPatterns) {
    query = query.replace(pattern, '')
  }

  // Remove trailing punctuation
  query = query.replace(/[?!.]+$/, '')

  // Limit length
  if (query.length > 400) {
    query = query.slice(0, 400)
  }

  return query.trim() || message.trim()
}
