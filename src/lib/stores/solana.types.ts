/**
 * Solana Types for Extension
 *
 * Client-side type definitions for Solana memecoin intelligence.
 */

/** Token data source */
export type TokenSource = 'jupiter' | 'pumpfun' | 'aggregated'

/** Base token data */
export interface SolanaToken {
  mint: string
  symbol: string
  name: string
  decimals: number
  logoUri?: string
  priceUsd: number
  priceChange24h?: number
  volume24h?: number
  marketCap?: number
  liquidity?: number
  source: TokenSource
  fetchedAt: number
}

/** Trending token with rank */
export interface TrendingToken extends SolanaToken {
  rank: number
  trendingScore?: number
}

/** New token launch from Pump.fun */
export interface NewLaunch {
  mint: string
  symbol: string
  name: string
  description?: string
  imageUri?: string
  createdAt: number
  creator?: string
  marketCap?: number
  replyCount?: number
  source: 'pumpfun'
}

/** API response wrapper */
export interface SolanaApiResponse<T> {
  success: boolean
  data: T
  responseTimeMs?: number
}

/** Token response */
export type TokenResponse = SolanaApiResponse<SolanaToken>

/** Trending response */
export type TrendingResponse = SolanaApiResponse<TrendingToken[]>

/** New launches response */
export type NewLaunchesResponse = SolanaApiResponse<NewLaunch[]>

/** SOL price response */
export interface SolPriceResponse {
  success: boolean
  data: {
    priceUsd: number
    fetchedAt: number
  }
}

/** Safety flag severity */
export type SafetySeverity = 'critical' | 'warning' | 'info'

/** Safety flag types */
export type SafetyFlagType =
  | 'honeypot'
  | 'rug_pull'
  | 'low_liquidity'
  | 'concentrated_holders'
  | 'mint_authority_enabled'
  | 'freeze_authority_enabled'
  | 'new_token'
  | 'low_holder_count'

/** Individual safety flag */
export interface SafetyFlag {
  type: SafetyFlagType
  severity: SafetySeverity
  message: string
}

/** Token safety rating */
export type SafetyRating = 'safe' | 'caution' | 'danger'

/** Full token safety analysis */
export interface TokenSafety {
  mint: string
  score: number
  rating: SafetyRating
  flags: SafetyFlag[]
  holderDistribution: {
    totalHolders: number
    top10Percentage: number
    top20Percentage: number
  }
  liquidity: {
    totalUsd: number
    lockedPercentage: number
  }
  contract: {
    mintAuthority: boolean
    freezeAuthority: boolean
  }
  tokenAge: {
    createdAt: number | null
    ageHours: number | null
  }
  analyzedAt: number
}

/** Safety response */
export type SafetyResponse = SolanaApiResponse<TokenSafety>

/** Wallet category for smart money tracking */
export type WalletCategory = 'whale' | 'influencer' | 'smart_money' | 'fund'

/** Smart money wallet */
export interface SmartMoneyWallet {
  address: string
  label: string
  category: WalletCategory
  description?: string
  twitterHandle?: string
}

/** Transaction type */
export type TransactionType = 'buy' | 'sell' | 'transfer'

/** Wallet transaction activity */
export interface WalletTransaction {
  signature: string
  type: TransactionType
  tokenMint: string
  tokenSymbol?: string
  tokenName?: string
  amount: number
  amountUsd?: number
  timestamp: number
  slot: number
}

/** Wallet activity summary */
export interface WalletActivity {
  address: string
  label?: string
  category?: WalletCategory
  recentTransactions: WalletTransaction[]
  stats: {
    totalBuys24h: number
    totalSells24h: number
    volumeUsd24h: number
    uniqueTokens24h: number
  }
  fetchedAt: number
}

/** Wallets response */
export type WalletsResponse = SolanaApiResponse<SmartMoneyWallet[]>

/** Wallet activity response */
export type WalletActivityResponse = SolanaApiResponse<WalletActivity>

/** Alert types */
export type AlertType = 'price_spike' | 'volume_spike' | 'new_listing' | 'whale_activity'

/** Alert severity */
export type AlertSeverity = 'low' | 'medium' | 'high'

/** Token alert */
export interface TokenAlert {
  id: string
  type: AlertType
  severity: AlertSeverity
  tokenMint: string
  tokenSymbol: string
  tokenName: string
  message: string
  data: {
    currentValue?: number
    previousValue?: number
    changePercent?: number
    threshold?: number
  }
  timestamp: number
}

/** Alert settings */
export interface AlertSettings {
  enabled: boolean
  priceThreshold: number
  volumeThreshold: number
  severityFilter: AlertSeverity[]
  soundEnabled: boolean
}

/** Social sentiment */
export type SocialSentiment = 'bullish' | 'bearish' | 'neutral'

/** Social tweet */
export interface SocialTweet {
  id: string
  author: string
  authorHandle: string
  content: string
  timestamp: number
  likes: number
  retweets: number
  replies: number
  url: string
}

/** Social signal data */
export interface SocialSignal {
  tokenSymbol: string
  tokenMint?: string
  sentiment: SocialSentiment
  sentimentScore: number
  tweetCount: number
  totalEngagement: number
  topTweets: SocialTweet[]
  keywords: string[]
  fetchedAt: number
}

/** Social response */
export type SocialResponse = SolanaApiResponse<SocialSignal>
