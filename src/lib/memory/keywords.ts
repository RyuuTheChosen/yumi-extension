/**
 * Keyword Extraction and Indexing for Memory System (Phase 2)
 *
 * Extracts meaningful keywords from memory content for faster retrieval.
 * Uses TF-IDF inspired weighting and entity detection.
 */

/**
 * Common stop words to filter out from keyword extraction
 */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that',
  'the', 'to', 'was', 'were', 'will', 'with', 'this', 'they', 'their',
  'them', 'been', 'have', 'had', 'being', 'but', 'not', 'what', 'when',
  'where', 'which', 'who', 'whom', 'why', 'how', 'all', 'each', 'every',
  'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'can',
  'should', 'now', 'also', 'into', 'over', 'after', 'before', 'between',
  'under', 'again', 'then', 'once', 'here', 'there', 'about', 'if',
  // Common verbs
  'do', 'does', 'did', 'doing', 'would', 'could', 'might', 'must',
  'shall', 'may', 'get', 'got', 'getting', 'make', 'made', 'making',
  'go', 'goes', 'went', 'going', 'come', 'comes', 'came', 'coming',
  'take', 'takes', 'took', 'taking', 'give', 'gives', 'gave', 'giving',
  'know', 'knows', 'knew', 'knowing', 'think', 'thinks', 'thought',
  'see', 'sees', 'saw', 'seeing', 'want', 'wants', 'wanted', 'wanting',
  'use', 'uses', 'used', 'using', 'find', 'finds', 'found', 'finding',
  'tell', 'tells', 'told', 'telling', 'ask', 'asks', 'asked', 'asking',
  'work', 'works', 'worked', 'working', 'seem', 'seems', 'seemed',
  'feel', 'feels', 'felt', 'feeling', 'try', 'tries', 'tried', 'trying',
  'leave', 'leaves', 'left', 'leaving', 'call', 'calls', 'called',
  'need', 'needs', 'needed', 'needing', 'keep', 'keeps', 'kept',
  'let', 'lets', 'putting', 'put', 'mean', 'means', 'meant',
  'become', 'becomes', 'became', 'becoming', 'begin', 'begins', 'began',
  // Pronouns and misc
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves',
  'you', 'your', 'yours', 'yourself', 'yourselves', 'she', 'her',
  'hers', 'herself', 'him', 'his', 'himself', 'itself', 'themselves',
  // Memory system specific
  'user', 'person', 'like', 'likes', 'prefer', 'prefers', 'favorite',
  'mentioned', 'said', 'told', 'shared', 'discussed', 'talked',
])

/**
 * Technical terms that should be preserved as-is (not stemmed)
 */
const TECH_TERMS = new Set([
  // Programming languages
  'javascript', 'typescript', 'python', 'rust', 'go', 'java', 'kotlin',
  'swift', 'ruby', 'php', 'c++', 'c#', 'scala', 'haskell', 'elixir',
  // Frameworks
  'react', 'vue', 'angular', 'svelte', 'next', 'nextjs', 'nuxt', 'remix',
  'express', 'fastify', 'nest', 'nestjs', 'django', 'flask', 'fastapi',
  'rails', 'spring', 'laravel', 'phoenix',
  // Tools & platforms
  'node', 'nodejs', 'deno', 'bun', 'npm', 'yarn', 'pnpm', 'vite',
  'webpack', 'rollup', 'esbuild', 'docker', 'kubernetes', 'k8s',
  'aws', 'gcp', 'azure', 'vercel', 'netlify', 'cloudflare',
  'github', 'gitlab', 'bitbucket', 'git',
  // Databases
  'postgres', 'postgresql', 'mysql', 'sqlite', 'mongodb', 'redis',
  'dynamodb', 'firebase', 'supabase', 'prisma', 'drizzle',
  // AI/ML
  'openai', 'anthropic', 'claude', 'gpt', 'chatgpt', 'llm', 'ai', 'ml',
  'tensorflow', 'pytorch', 'huggingface',
  // Other tech
  'api', 'rest', 'graphql', 'websocket', 'http', 'https', 'json', 'xml',
  'css', 'html', 'sass', 'less', 'tailwind', 'bootstrap',
  'linux', 'macos', 'windows', 'ubuntu', 'debian',
])

/**
 * Patterns for detecting entities (names, places, etc.)
 */
const ENTITY_PATTERNS = {
  // Capitalized words (potential names/proper nouns)
  properNoun: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
  // CamelCase (likely tech terms)
  camelCase: /\b[A-Z][a-z]+[A-Z][a-zA-Z]*\b/g,
  // Acronyms
  acronym: /\b[A-Z]{2,}\b/g,
  // Version numbers (v1.0, 3.x, etc.)
  version: /\bv?\d+(?:\.\d+)*(?:\.x)?\b/g,
  // Hashtag style
  hashtag: /#[a-zA-Z][a-zA-Z0-9_]*/g,
}

/**
 * Extract keywords from text content
 */
export function extractKeywords(text: string): string[] {
  const keywords = new Set<string>()

  // Extract entities first (preserve case for these)
  const entities = extractEntities(text)
  entities.forEach(e => keywords.add(e.toLowerCase()))

  // Tokenize and process remaining words
  const tokens = tokenize(text)

  for (const token of tokens) {
    const lower = token.toLowerCase()

    // Skip stop words
    if (STOP_WORDS.has(lower)) continue

    // Skip very short tokens (unless they're tech terms)
    if (lower.length < 3 && !TECH_TERMS.has(lower)) continue

    // Skip pure numbers
    if (/^\d+$/.test(lower)) continue

    // Add the keyword
    keywords.add(lower)
  }

  return Array.from(keywords)
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&')
}

/**
 * Extract named entities from text
 */
export function extractEntities(text: string): string[] {
  const entities = new Set<string>()

  // Check for tech terms (case-insensitive)
  for (const term of TECH_TERMS) {
    const escapedTerm = escapeRegex(term)
    const regex = new RegExp(`\\b${escapedTerm}\\b`, 'gi')
    if (regex.test(text)) {
      entities.add(term)
    }
  }

  // Extract proper nouns
  const properNouns = text.match(ENTITY_PATTERNS.properNoun) || []
  properNouns.forEach(pn => {
    // Filter out common sentence starters
    if (!STOP_WORDS.has(pn.toLowerCase()) && pn.length > 1) {
      entities.add(pn)
    }
  })

  // Extract CamelCase terms
  const camelCase = text.match(ENTITY_PATTERNS.camelCase) || []
  camelCase.forEach(cc => entities.add(cc))

  // Extract acronyms
  const acronyms = text.match(ENTITY_PATTERNS.acronym) || []
  acronyms.forEach(acr => {
    // Filter out common acronyms that are also words
    if (acr.length >= 2) {
      entities.add(acr)
    }
  })

  return Array.from(entities)
}

/**
 * Tokenize text into words
 */
function tokenize(text: string): string[] {
  // Replace punctuation with spaces, split on whitespace
  return text
    .replace(/[^\w\s#]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0)
}

/**
 * Calculate Jaccard similarity between two sets of keywords
 */
export function jaccardSimilarity(set1: string[], set2: string[]): number {
  const s1 = new Set(set1.map(s => s.toLowerCase()))
  const s2 = new Set(set2.map(s => s.toLowerCase()))

  if (s1.size === 0 && s2.size === 0) return 1
  if (s1.size === 0 || s2.size === 0) return 0

  let intersection = 0
  for (const item of s1) {
    if (s2.has(item)) intersection++
  }

  const union = s1.size + s2.size - intersection
  return intersection / union
}

/**
 * Calculate weighted keyword overlap score
 * Gives higher weight to rare/important keywords
 */
export function weightedKeywordScore(
  queryKeywords: string[],
  memoryKeywords: string[],
  allMemoryKeywords: Map<string, number> // keyword -> frequency across all memories
): number {
  if (queryKeywords.length === 0 || memoryKeywords.length === 0) return 0

  const memorySet = new Set(memoryKeywords.map(k => k.toLowerCase()))
  let score = 0
  let maxPossible = 0

  for (const keyword of queryKeywords) {
    const lower = keyword.toLowerCase()
    // IDF-like weight: rare keywords get higher weight
    const frequency = allMemoryKeywords.get(lower) || 0
    const totalMemories = Math.max(allMemoryKeywords.size, 1)
    const weight = frequency > 0
      ? Math.log(totalMemories / frequency) + 1
      : 2 // New keywords get high weight

    maxPossible += weight

    if (memorySet.has(lower)) {
      score += weight
    }
  }

  return maxPossible > 0 ? score / maxPossible : 0
}

/**
 * Build a keyword frequency index from all memories
 */
export function buildKeywordIndex(
  memories: Array<{ content: string; context?: string }>
): Map<string, number> {
  const index = new Map<string, number>()

  for (const memory of memories) {
    const text = memory.content + ' ' + (memory.context || '')
    const keywords = extractKeywords(text)

    for (const keyword of keywords) {
      const lower = keyword.toLowerCase()
      index.set(lower, (index.get(lower) || 0) + 1)
    }
  }

  return index
}

/**
 * Check if a keyword is a technology/tool name
 */
export function isTechTerm(keyword: string): boolean {
  return TECH_TERMS.has(keyword.toLowerCase())
}

/**
 * Normalize a keyword for comparison
 */
export function normalizeKeyword(keyword: string): string {
  return keyword.toLowerCase().trim()
}

/**
 * Get keyword matches between query and memory
 * Returns matched keywords for debugging/display
 */
export function getMatchingKeywords(
  queryKeywords: string[],
  memoryKeywords: string[]
): string[] {
  const memorySet = new Set(memoryKeywords.map(k => k.toLowerCase()))
  return queryKeywords.filter(k => memorySet.has(k.toLowerCase()))
}
