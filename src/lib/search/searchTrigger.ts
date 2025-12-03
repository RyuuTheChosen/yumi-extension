const FRESHNESS_PATTERNS = [
  /\b(today|yesterday|this week|this month|this year)\b/i,
  /\b(latest|recent|current|now|new|newest|updated)\b/i,
  /\b(2024|2025|2026)\b/,
]

const NEWS_PATTERNS = [
  /\b(news|happened|announced|released|launched|update)\b/i,
  /\b(breaking|trending|viral|popular)\b/i,
  /\b(event|conference|summit|election)\b/i,
]

const REALTIME_PATTERNS = [
  /\b(price|stock|crypto|bitcoin|eth|currency)\b/i,
  /\b(weather|forecast|temperature)\b/i,
  /\b(score|game|match|result)\b/i,
  /\b(status|availability|open|closed)\b/i,
]

const EXPLICIT_PATTERNS = [
  /\b(search|look up|find out|google|research)\b/i,
  /\b(what is the|who is the|where is the)\b/i,
  /\b(can you find|can you search|can you look)\b/i,
]

const KNOWLEDGE_PATTERNS = [
  /\b(how do i|how to|how can i)\b/i,
  /\b(what are the|what is a|what does)\b/i,
  /\b(who is|who are|who was)\b/i,
  /\b(when did|when will|when is)\b/i,
  /\b(where can|where is|where are)\b/i,
]

const CODE_PATTERNS = [
  /```/,
  /\b(function|const|let|var|class|import|export)\b/,
  /\b(error|bug|fix|debug|code|script)\b/i,
  /\b(typescript|javascript|python|react|vue|node)\b/i,
]

export function analyzeSearchNeed(message: string): {
  shouldSearch: boolean
  confidence: number
  reason: string
} {
  const normalizedMessage = message.toLowerCase().trim()

  if (normalizedMessage.length < 10) {
    return { shouldSearch: false, confidence: 0, reason: 'Message too short' }
  }

  const codeMatchCount = CODE_PATTERNS.filter(p => p.test(message)).length
  if (codeMatchCount >= 2) {
    return { shouldSearch: false, confidence: 0.1, reason: 'Appears to be code-related' }
  }

  let score = 0
  const reasons: string[] = []

  if (EXPLICIT_PATTERNS.some(p => p.test(message))) {
    score += 0.5
    reasons.push('explicit search request')
  }

  if (FRESHNESS_PATTERNS.some(p => p.test(message))) {
    score += 0.3
    reasons.push('freshness indicator')
  }

  if (NEWS_PATTERNS.some(p => p.test(message))) {
    score += 0.3
    reasons.push('news/events query')
  }

  if (REALTIME_PATTERNS.some(p => p.test(message))) {
    score += 0.4
    reasons.push('real-time data query')
  }

  if (KNOWLEDGE_PATTERNS.some(p => p.test(message))) {
    score += 0.15
    reasons.push('knowledge question')
  }

  const confidence = Math.min(score, 1)
  const shouldSearch = confidence >= 0.3

  return {
    shouldSearch,
    confidence,
    reason: reasons.length > 0 ? reasons.join(', ') : 'No search patterns detected',
  }
}

export function shouldSuggestSearch(message: string): boolean {
  return analyzeSearchNeed(message).shouldSearch
}

export function extractSearchQuery(message: string): string {
  let query = message.trim()

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

  query = query.replace(/[?!.]+$/, '')

  if (query.length > 400) {
    query = query.slice(0, 400)
  }

  return query.trim() || message.trim()
}
