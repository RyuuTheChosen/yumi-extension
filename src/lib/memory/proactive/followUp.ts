/**
 * Follow-up System for Proactive Memory
 *
 * Detects memories that warrant follow-up questions and generates
 * appropriate questions using templates.
 */

import type { Memory, MemoryType } from '../types'

export interface FollowUpCandidate {
  memory: Memory
  reason: FollowUpReason
  suggestedQuestion: string
  priority: number // 0-1, higher = more urgent
}

export type FollowUpReason =
  | 'event_passed' // Event date has passed
  | 'event_upcoming' // Event is tomorrow/today
  | 'project_stale' // No mention in 7+ days
  | 'skill_milestone' // Learning something for 1 week/1 month
  | 'person_check' // Haven't mentioned someone in 2+ weeks

interface FollowUpRule {
  types: MemoryType[]
  condition: (m: Memory, now: number) => boolean
  priority: number
}

const FOLLOW_UP_RULES: Record<FollowUpReason, FollowUpRule> = {
  event_passed: {
    types: ['event'],
    condition: (m, now) => {
      // Use expiresAt if set, otherwise check for date patterns in content
      if (m.expiresAt && now > m.expiresAt) return true
      const eventDate = extractDateFromContent(m.content, m.createdAt)
      return eventDate !== null && now > eventDate + 24 * 60 * 60 * 1000
    },
    priority: 0.9,
  },
  event_upcoming: {
    types: ['event'],
    condition: (m, now) => {
      const eventDate = m.expiresAt || extractDateFromContent(m.content, m.createdAt)
      if (!eventDate) return false
      const hoursUntil = (eventDate - now) / (60 * 60 * 1000)
      return hoursUntil > 0 && hoursUntil <= 24
    },
    priority: 0.95,
  },
  project_stale: {
    types: ['project'],
    condition: (m, now) => daysSince(m.lastAccessed, now) > 7,
    priority: 0.6,
  },
  skill_milestone: {
    types: ['skill'],
    condition: (m, now) => {
      const days = daysSince(m.createdAt, now)
      // Check for milestone days (7, 30, 90)
      return days >= 7 && days <= 8 || days >= 30 && days <= 31 || days >= 90 && days <= 91
    },
    priority: 0.5,
  },
  person_check: {
    types: ['person'],
    condition: (m, now) => daysSince(m.lastAccessed, now) > 14,
    priority: 0.4,
  },
}

// Template-based question generation (no API cost)
const FOLLOW_UP_TEMPLATES: Record<FollowUpReason, string[]> = {
  event_passed: [
    'How did {subject} go?',
    'Hey, how was {subject}?',
    'So... {subject} - how did it turn out?',
  ],
  event_upcoming: [
    'Ready for {subject}?',
    '{subject} is coming up soon!',
    'Good luck with {subject}!',
  ],
  project_stale: [
    'Any progress on {subject}?',
    'Still working on {subject}?',
    "How's {subject} coming along?",
  ],
  skill_milestone: [
    "How's learning {subject} going?",
    'Still practicing {subject}?',
    'Getting better at {subject}?',
  ],
  person_check: ["How's {subject} doing?", 'Heard from {subject} lately?'],
}

/**
 * Get follow-up candidates from memories
 */
export function getFollowUpCandidates(
  memories: Memory[],
  cooldowns: Map<string, number>
): FollowUpCandidate[] {
  const now = Date.now()
  const candidates: FollowUpCandidate[] = []

  for (const memory of memories) {
    // Skip if on cooldown
    if (isOnCooldown(memory.id, cooldowns, now)) continue

    // Skip low importance memories
    if (memory.importance < 0.3) continue

    for (const [reason, rule] of Object.entries(FOLLOW_UP_RULES)) {
      if (!rule.types.includes(memory.type)) continue
      if (!rule.condition(memory, now)) continue

      candidates.push({
        memory,
        reason: reason as FollowUpReason,
        suggestedQuestion: generateFollowUpQuestion(memory, reason as FollowUpReason),
        priority: rule.priority * memory.importance,
      })
      break // One reason per memory
    }
  }

  return candidates.sort((a, b) => b.priority - a.priority)
}

/**
 * Generate a follow-up question using templates
 */
function generateFollowUpQuestion(memory: Memory, reason: FollowUpReason): string {
  const templates = FOLLOW_UP_TEMPLATES[reason]
  const template = templates[Math.floor(Math.random() * templates.length)]
  const subject = extractSubject(memory.content)
  return template.replace('{subject}', subject)
}

/**
 * Extract the main subject from memory content
 */
export function extractSubject(content: string): string {
  return content
    .replace(/^(User is |User has |User's |They are |Their )/i, '')
    .replace(/^(working on |learning |studying |practicing )/i, '')
    .split(/[,.]/)[0]
    .trim()
    .substring(0, 50)
}

/**
 * Parse dates from natural language in memory content
 * Uses createdAt as reference point for relative dates
 */
function extractDateFromContent(content: string, createdAt: number): number | null {
  const lower = content.toLowerCase()
  const referenceDate = new Date(createdAt)

  // "tomorrow" - relative to when memory was created
  if (lower.includes('tomorrow')) {
    const date = new Date(referenceDate)
    date.setDate(date.getDate() + 1)
    date.setHours(12, 0, 0, 0)
    return date.getTime()
  }

  // "today" - relative to when memory was created
  if (lower.includes('today')) {
    const date = new Date(referenceDate)
    date.setHours(23, 59, 59, 999)
    return date.getTime()
  }

  // "this weekend"
  if (lower.includes('this weekend')) {
    const date = new Date(referenceDate)
    const dayOfWeek = date.getDay()
    const daysUntilSaturday = (6 - dayOfWeek + 7) % 7 || 7
    date.setDate(date.getDate() + daysUntilSaturday)
    date.setHours(12, 0, 0, 0)
    return date.getTime()
  }

  // Day of week patterns (e.g., "on Friday", "this Monday")
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  for (let i = 0; i < days.length; i++) {
    if (lower.includes(days[i])) {
      const date = new Date(referenceDate)
      const currentDay = date.getDay()
      const diff = (i - currentDay + 7) % 7 || 7
      date.setDate(date.getDate() + diff)
      date.setHours(12, 0, 0, 0)
      return date.getTime()
    }
  }

  // Month + day patterns: "Dec 15", "December 15"
  const monthNames = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ]
  const monthPattern = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/i
  const monthMatch = lower.match(monthPattern)
  if (monthMatch) {
    const monthIndex = monthNames.findIndex((m) => monthMatch[1].toLowerCase().startsWith(m))
    const day = parseInt(monthMatch[2], 10)
    if (monthIndex !== -1 && day >= 1 && day <= 31) {
      const date = new Date(referenceDate)
      date.setMonth(monthIndex, day)
      date.setHours(12, 0, 0, 0)
      // If the date is in the past, assume next year
      if (date.getTime() < referenceDate.getTime()) {
        date.setFullYear(date.getFullYear() + 1)
      }
      return date.getTime()
    }
  }

  // Numeric date patterns: "12/15", "12-15"
  const numericPattern = /\b(\d{1,2})[/-](\d{1,2})\b/
  const numericMatch = lower.match(numericPattern)
  if (numericMatch) {
    const month = parseInt(numericMatch[1], 10) - 1
    const day = parseInt(numericMatch[2], 10)
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const date = new Date(referenceDate)
      date.setMonth(month, day)
      date.setHours(12, 0, 0, 0)
      // If the date is in the past, assume next year
      if (date.getTime() < referenceDate.getTime()) {
        date.setFullYear(date.getFullYear() + 1)
      }
      return date.getTime()
    }
  }

  return null
}

/**
 * Calculate days since a timestamp
 */
function daysSince(timestamp: number, now: number): number {
  return Math.floor((now - timestamp) / (24 * 60 * 60 * 1000))
}

/**
 * Check if a memory is on cooldown
 */
function isOnCooldown(memoryId: string, cooldowns: Map<string, number>, now: number): boolean {
  const expiresAt = cooldowns.get(memoryId)
  return expiresAt !== undefined && now < expiresAt
}
