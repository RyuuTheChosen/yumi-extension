export * from './types'
export {
  performSearch,
  formatSearchResultsForPrompt,
  clearSearchCache,
  getSearchCacheSize,
} from './searchService'
export {
  analyzeSearchNeed,
  shouldSuggestSearch,
  extractSearchQuery,
} from './searchTrigger'
