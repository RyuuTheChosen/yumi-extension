/**
 * Conversation Module
 *
 * Provides conversation summarization and cross-context search.
 * Enables Yumi to reference and link past conversations.
 */

export {
  generateConversationSummary,
  createSummaryObject,
  shouldGenerateSummary,
  formatMessagesPreview,
  type SummaryMessage,
  type SummaryGenerationResult
} from './summaryGenerator'

export {
  findConversationsByMemories,
  findConversationsByTopics,
  findConversationsBySemantic,
  findRelatedConversations,
  formatRelatedConversationsContext,
  type RelatedConversation,
  type CrossContextOptions
} from './crossContext'
