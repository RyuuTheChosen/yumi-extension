export { getFollowUpCandidates, extractSubject } from './followUp'
export type { FollowUpCandidate, FollowUpReason } from './followUp'
export { findContextMatches, detectPageType } from './contextMatcher'
export type { ContextMatch, PageContext } from './contextMatcher'
export { ProactiveMemoryController, loadProactiveHistory } from './proactiveController'
export type {
  ProactiveAction,
  ProactiveActionType,
  ProactiveConfig,
  ProactiveHistoryEntry,
} from './proactiveController'
