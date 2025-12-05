/**
 * Extension Type Definitions - Central Export
 *
 * Import all types from this single file for consistency.
 */

// Store types
export type {
  SettingsState,
  SettingsStore,
  Message,
  SearchSource,
  ChatScope,
  ChatState,
  ChatStore,
  MemoryState,
  Memory,
  MemoryStore,
  Personality,
  PersonalityState,
  PersonalityStore,
  HubUser,
  SettingsStateWithAuth,
  MessageContent,
  PageContext,
} from './stores'

// Vision types
export type {
  VisionQueryPayload,
  VisionQueryResponse,
  ScreenshotOptions,
  ScreenshotResult,
  ImageElementInfo,
  VisionAPIRequest,
  VisionCapability,
} from './vision'

// Runtime message types
export type {
  RuntimeMessage,
  StreamChunkMessage,
  StreamEndMessage,
  StreamErrorMessage,
  MemoryExtractionMessage,
  MemoryGetAllMessage,
  MemoryAddMessage,
  CompanionChangedMessage,
  PortConnectMessage,
  PortHeartbeatMessage,
  ExtensionMessage,
  MessageHandler,
  PortMessageHandler,
} from './runtime'
