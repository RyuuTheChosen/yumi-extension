/**
 * Proactive Memory Controller
 *
 * Central controller for all proactive memory behaviors including:
 * - Welcome back greetings
 * - Follow-up questions
 * - Context-based matching
 * - Random recall
 * - Feedback tracking
 */

import { createLogger } from '../debug'
import type { Memory } from './types'
import { getFollowUpCandidates, type FollowUpCandidate, extractSubject } from './followUp'
import { findContextMatches, type PageContext } from './contextMatcher'

const log = createLogger('ProactiveController')

// Proactive action types
export type ProactiveActionType = 'welcome_back' | 'follow_up' | 'context_match' | 'random_recall'

export interface ProactiveAction {
  type: ProactiveActionType
  message: string
  memory?: Memory
  metadata?: {
    absenceDays?: number
    matchType?: string
    reason?: string
  }
}

export interface ProactiveConfig {
  enabled: boolean
  followUpEnabled: boolean
  contextMatchEnabled: boolean
  randomRecallEnabled: boolean
  welcomeBackEnabled: boolean
  cooldownMinutes: number // Global cooldown between any proactive message
  maxPerSession: number // Max proactive messages per session
  displayMode: 'bubble' | 'chat'
}

// Default configuration
const DEFAULT_CONFIG: ProactiveConfig = {
  enabled: true,
  followUpEnabled: true,
  contextMatchEnabled: true,
  randomRecallEnabled: true,
  welcomeBackEnabled: true,
  cooldownMinutes: 10,
  maxPerSession: 10,
  displayMode: 'bubble',
}

// Proactive history entry
export interface ProactiveHistoryEntry {
  id: string
  type: ProactiveActionType
  message: string
  memoryId?: string
  timestamp: number
  engaged: boolean | null // null = no interaction yet
}

// Persisted state (survives page reload)
interface ProactiveState {
  lastProactiveAt: number
  sessionCount: number
  sessionStartedAt: number
  lastSessionEndedAt: number | null
  memoryCooldowns: Record<string, number> // memoryId -> expiresAt
  history: ProactiveHistoryEntry[] // Recent proactive messages
}

const STORAGE_KEY = 'yumi-proactive-state'

// Absence thresholds in days
const ABSENCE_THRESHOLDS = {
  short: 1, // 1+ days
  medium: 3, // 3+ days
  long: 7, // 1+ week
  extended: 30, // 1+ month
}

// Random recall message templates
const RECALL_TEMPLATES: Record<string, string[]> = {
  project: ["How's {content} coming along?", 'Any updates on {content}?', 'Still working on {content}?'],
  skill: ["How's learning {content} going?", 'Getting better at {content}?', 'Still practicing {content}?'],
  person: ["How's {content} doing?", 'Heard from {content} lately?'],
  preference: ['Still into {content}?'],
  opinion: ['Still feel that way about {content}?'],
  event: ['Remember {content}?'],
}

/**
 * Proactive Memory Controller
 */
export class ProactiveMemoryController {
  private config: ProactiveConfig
  private state: ProactiveState
  private stateLoaded: boolean = false

  constructor(config: Partial<ProactiveConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.state = {
      lastProactiveAt: 0,
      sessionCount: 0,
      sessionStartedAt: Date.now(),
      lastSessionEndedAt: null,
      memoryCooldowns: {},
      history: [],
    }
  }

  /**
   * Initialize the controller - load persisted state
   */
  async initialize(): Promise<void> {
    await this.loadState()
    this.stateLoaded = true

    // Clean up expired cooldowns
    this.pruneExpiredCooldowns()

    // Track session end for welcome back feature
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.onSessionEnd())
    }
  }

  /**
   * Load persisted state from Chrome storage
   */
  private async loadState(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY)
      if (result[STORAGE_KEY]) {
        const saved = result[STORAGE_KEY] as Partial<ProactiveState>
        this.state = {
          ...this.state,
          lastSessionEndedAt: saved.lastSessionEndedAt ?? null,
          memoryCooldowns: saved.memoryCooldowns || {},
          history: saved.history || [],
        }
      }
    } catch (err) {
      log.warn('Failed to load state:', err)
    }
  }

  /**
   * Save state to Chrome storage
   */
  private async saveState(): Promise<void> {
    try {
      const trimmedHistory = this.state.history.slice(-20)
      await chrome.storage.local.set({
        [STORAGE_KEY]: {
          lastSessionEndedAt: this.state.lastSessionEndedAt,
          memoryCooldowns: this.state.memoryCooldowns,
          history: trimmedHistory,
        },
      })
    } catch (err) {
      log.warn('Failed to save state:', err)
    }
  }

  /**
   * Handle session end - save timestamp for welcome back
   */
  private onSessionEnd(): void {
    this.state.lastSessionEndedAt = Date.now()
    // Sync save on unload using sendBeacon or direct storage
    chrome.storage.local.set({
      [STORAGE_KEY]: {
        lastSessionEndedAt: Date.now(),
        memoryCooldowns: this.state.memoryCooldowns,
      },
    })
  }

  /**
   * Remove expired cooldowns from state
   */
  private pruneExpiredCooldowns(): void {
    const now = Date.now()
    for (const [id, expiresAt] of Object.entries(this.state.memoryCooldowns)) {
      if (now > expiresAt) {
        delete this.state.memoryCooldowns[id]
      }
    }
  }

  /**
   * Check if we can be proactive right now
   */
  canBeProactive(): boolean {
    if (!this.config.enabled) return false
    if (!this.stateLoaded) return false

    const now = Date.now()
    const cooldownMs = this.config.cooldownMinutes * 60 * 1000

    if (now - this.state.lastProactiveAt < cooldownMs) return false
    if (this.state.sessionCount >= this.config.maxPerSession) return false

    return true
  }

  /**
   * Get the best proactive action to take
   */
  async getProactiveAction(
    memories: Memory[],
    context?: PageContext,
    isSessionStart: boolean = false
  ): Promise<ProactiveAction | null> {
    if (!this.canBeProactive()) return null

    const cooldownMap = new Map(
      Object.entries(this.state.memoryCooldowns).map(([k, v]) => [k, v])
    )

    // Priority 1: Welcome back (session start only)
    if (isSessionStart && this.config.welcomeBackEnabled) {
      const welcomeBack = this.checkWelcomeBack(memories, cooldownMap)
      if (welcomeBack) {
        return welcomeBack
      }
    }

    // Priority 2: Due follow-ups
    if (this.config.followUpEnabled) {
      const followUps = getFollowUpCandidates(memories, cooldownMap)
      if (followUps.length > 0) {
        const top = followUps[0]
        return {
          type: 'follow_up',
          message: top.suggestedQuestion,
          memory: top.memory,
          metadata: { reason: top.reason },
        }
      }
    }

    // Priority 3: Context matches (if on a page)
    if (this.config.contextMatchEnabled && context) {
      const matches = findContextMatches(context, memories, cooldownMap)
      if (matches.length > 0 && matches[0].relevance > 0.5) {
        const top = matches[0]
        return {
          type: 'context_match',
          message: `Hey, ${top.explanation}!`,
          memory: top.memory,
          metadata: { matchType: top.matchType },
        }
      }
    }

    // Priority 4: Random recall (weighted probability)
    if (this.config.randomRecallEnabled) {
      const recall = this.selectRandomRecall(memories, cooldownMap)
      if (recall) {
        return recall
      }
    }

    return null
  }

  /**
   * Check for welcome back greeting
   */
  private checkWelcomeBack(
    memories: Memory[],
    cooldowns: Map<string, number>
  ): ProactiveAction | null {
    if (!this.state.lastSessionEndedAt) return null

    const now = Date.now()
    const absenceMs = now - this.state.lastSessionEndedAt
    const absenceDays = Math.floor(absenceMs / (24 * 60 * 60 * 1000))

    if (absenceDays < ABSENCE_THRESHOLDS.short) return null

    // Get any due follow-ups to mention
    const followUps = getFollowUpCandidates(memories, cooldowns)
    const topFollowUp = followUps[0]

    let greeting: string

    if (absenceDays >= ABSENCE_THRESHOLDS.extended) {
      greeting = topFollowUp
        ? `It's been a while! ${topFollowUp.suggestedQuestion}`
        : 'Hey, long time no see!'
    } else if (absenceDays >= ABSENCE_THRESHOLDS.long) {
      greeting = topFollowUp
        ? `Welcome back! By the way, ${topFollowUp.suggestedQuestion.toLowerCase()}`
        : 'Welcome back!'
    } else if (absenceDays >= ABSENCE_THRESHOLDS.medium) {
      greeting = topFollowUp ? `Hey again! ${topFollowUp.suggestedQuestion}` : 'Hey, good to see you!'
    } else {
      greeting = 'Hey!'
    }

    return {
      type: 'welcome_back',
      message: greeting,
      memory: topFollowUp?.memory,
      metadata: { absenceDays },
    }
  }

  /**
   * Select a random memory to recall
   */
  private selectRandomRecall(
    memories: Memory[],
    cooldowns: Map<string, number>
  ): ProactiveAction | null {
    const now = Date.now()

    const timeSinceLastMs = now - this.state.lastProactiveAt
    const hoursSinceLast = timeSinceLastMs / (60 * 60 * 1000)
    const probability = Math.min(0.05 + hoursSinceLast * 0.02, 0.3)

    if (Math.random() > probability) return null

    const eligible = memories.filter((m) => {
      if (m.type === 'identity') return false
      if (m.importance < 0.5) return false
      if (m.confidence < 0.6) return false
      if (this.isOnCooldown(m.id, cooldowns, now)) return false
      return true
    })

    if (eligible.length === 0) return null

    const weighted = eligible.map((m) => {
      const daysSinceAccessed = (now - m.lastAccessed) / (24 * 60 * 60 * 1000)
      const recencyWeight = Math.min(daysSinceAccessed / 14, 1)
      const engagementWeight = Math.min(m.accessCount * 0.1, 0.5)

      const weight =
        m.importance * 0.5 +
        m.confidence * 0.2 +
        recencyWeight * 0.2 +
        engagementWeight * 0.1

      return { memory: m, weight }
    })

    const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0)
    let random = Math.random() * totalWeight

    for (const { memory, weight } of weighted) {
      random -= weight
      if (random <= 0) {
        return {
          type: 'random_recall',
          message: this.generateRecallMessage(memory),
          memory,
        }
      }
    }

    return null
  }

  /**
   * Generate a recall message from templates
   */
  private generateRecallMessage(memory: Memory): string {
    const templates = RECALL_TEMPLATES[memory.type] || ['Thinking about {content}...']
    const template = templates[Math.floor(Math.random() * templates.length)]
    const subject = extractSubject(memory.content)
    return template.replace('{content}', subject)
  }

  /**
   * Check if a memory is on cooldown
   */
  private isOnCooldown(memoryId: string, cooldowns: Map<string, number>, now: number): boolean {
    const expiresAt = cooldowns.get(memoryId)
    return expiresAt !== undefined && now < expiresAt
  }

  /**
   * Record that we displayed a proactive message
   */
  recordProactive(memoryId?: string, action?: ProactiveAction): void {
    const now = Date.now()
    this.state.lastProactiveAt = now
    this.state.sessionCount++

    if (memoryId) {
      this.state.memoryCooldowns[memoryId] = now + 24 * 60 * 60 * 1000
    }

    if (action) {
      const historyEntry: ProactiveHistoryEntry = {
        id: crypto.randomUUID(),
        type: action.type,
        message: action.message,
        memoryId: action.memory?.id,
        timestamp: now,
        engaged: null,
      }
      this.state.history.push(historyEntry)
    }

    this.saveState()
  }

  /**
   * Record user feedback for a proactive message
   */
  recordFeedback(memoryId: string, action: 'engaged' | 'dismissed' | 'ignored'): void {
    const historyEntry = this.state.history.find(h => h.memoryId === memoryId && h.engaged === null)
    if (historyEntry) {
      historyEntry.engaged = action === 'engaged'
    }

    switch (action) {
      case 'engaged':
        break
      case 'dismissed':
        this.state.memoryCooldowns[memoryId] = Date.now() + 48 * 60 * 60 * 1000
        break
      case 'ignored':
        this.state.memoryCooldowns[memoryId] = Date.now() + 24 * 60 * 60 * 1000
        break
    }

    this.saveState()
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ProactiveConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Get current configuration
   */
  getConfig(): ProactiveConfig {
    return { ...this.config }
  }

  /**
   * Get proactive history
   */
  getHistory(): ProactiveHistoryEntry[] {
    return [...this.state.history].reverse()
  }

  /**
   * Reset session count (for testing)
   */
  resetSessionCount(): void {
    this.state.sessionCount = 0
  }

  /**
   * Clear proactive history
   */
  clearHistory(): void {
    this.state.history = []
    this.saveState()
  }
}

/**
 * Load proactive history from Chrome storage (for popup/other contexts)
 */
export async function loadProactiveHistory(): Promise<ProactiveHistoryEntry[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY)
    if (result[STORAGE_KEY]?.history) {
      return [...result[STORAGE_KEY].history].reverse()
    }
    return []
  } catch (err) {
    log.warn('Failed to load history:', err)
    return []
  }
}
