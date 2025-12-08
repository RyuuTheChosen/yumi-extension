/**
 * Solana Plugin
 *
 * Enables Solana memecoin intelligence for companions.
 * Provides trending tokens, new launches, and price data.
 */

import type { Plugin, PromptContext, TriggerResult } from '../types'
import { useSolanaStore } from '../../stores/solana.store'

/** Explicit Solana query patterns (high confidence) */
const EXPLICIT_PATTERNS = [
  /\b(solana|sol)\s+(trending|price|tokens?|meme)/i,
  /\b(trending|new|hot)\s+(on\s+)?(solana|pump\.?fun)/i,
  /\b(check|show|find|get)\s+(me\s+)?(solana|sol|meme)/i,
  /\bwhat'?s?\s+(trending|hot|new)\s+(on\s+)?(solana|sol)/i,
  /\bpump\.?fun\s+(trending|new|launch)/i,
  /\bnew\s+launches?\s+(on\s+)?(solana|pump)/i,
  /\b(is\s+(this|it)\s+)?(safe|legit|rug|scam)/i,
  /\b(check|analyze|scan)\s+(safety|risk|rug)/i,
  /\b(rug\s*pull|honeypot|scam)\s*(check|detect|analysis)?/i,
  /\b(whale|whales?|smart\s*money)\s+(buying|selling|activity|watching)/i,
  /\bwhat\s+(are|is)\s+(whales?|smart\s*money)\s+(buying|doing)/i,
  /\b(track|follow|watch)\s+(whale|wallet|smart\s*money)/i,
  /\b(buzz|sentiment|hype|twitter|social)\s+(on|about|for)\s+\$?[A-Z]/i,
  /\bwhat('?s| is)\s+(the\s+)?(buzz|sentiment|hype)\s+(on|about|for)/i,
  /\b(twitter|social|ct)\s+(saying|talking|thinks?)\s+(about)?/i,
]

/** General crypto patterns (medium confidence when multiple match) */
const GENERAL_PATTERNS = [
  /\b(memecoin|meme\s*coin)/i,
  /\b(solana|sol)\b/i,
  /\b(pump\.?fun|raydium|jupiter)\b/i,
  /\b(trending|pumping|mooning)/i,
  /\b(token|coin)\s+(price|market)/i,
  /\b(degen|ape|rug)/i,
  /\$[A-Z]{2,10}\b/,
]

/** Detect query type from message */
function detectQueryType(message: string): string {
  const lower = message.toLowerCase()
  if (/\b(safe|legit|rug|scam|honeypot|risk)/i.test(lower)) return 'safety'
  if (/\b(whale|whales|smart\s*money)/i.test(lower)) return 'wallets'
  if (/\b(buzz|sentiment|hype|twitter|social|ct)/i.test(lower)) return 'social'
  if (/\b(trending|hot|top|pump)/i.test(lower)) return 'trending'
  if (/\b(new|launch|recent|latest)/i.test(lower)) return 'new_launches'
  if (/\b(price|worth|value)\b/i.test(lower)) return 'price'
  if (/\$[A-Z]{2,10}\b/.test(message)) return 'token_lookup'
  return 'general'
}

export const solanaPlugin: Plugin = {
  manifest: {
    id: 'solana',
    name: 'Solana Intelligence',
    description: 'Real-time Solana memecoin data from Jupiter and Pump.fun',
    version: '1.0.0',
  },

  getPromptAdditions: (_context: PromptContext) => {
    return `## Solana Memecoin Intelligence
You have access to real-time Solana token data:

**Available Data**:
- Trending tokens on Pump.fun (sorted by market cap)
- New token launches (most recent first)
- Token prices from Jupiter aggregator
- Current SOL price
- Token safety analysis (holder distribution, contract risks, liquidity)
- Smart money wallet tracking (whales, influencers, funds)

**Safety Analysis Features**:
- Score 0-100 with rating: safe (70+), caution (40-69), danger (<40)
- Checks: mint authority, freeze authority, holder concentration
- Flags: rug pull indicators, honeypot signs, low liquidity warnings
- Token age analysis (new tokens = higher risk)

**Wallet Tracking Features**:
- Curated list of smart money wallets (whales, influencers, funds)
- Recent transaction activity per wallet
- 24h stats: buys, sells, volume, unique tokens
- Categories: whale, influencer, smart_money, fund

**When Discussing Crypto**:
- Always mention this is NOT financial advice
- Highlight risks of memecoins (volatility, rug pulls, low liquidity)
- Use data from context when provided
- Be specific about market caps and prices when available
- Pump.fun tokens often have 6 decimals

**Safety Response Format** (when analyzing tokens):
- Lead with safety score and rating
- List critical flags first (red flags)
- Explain holder concentration risks
- Note contract authority status (mint/freeze)
- Provide actionable risk summary

**Response Format** (when sharing token data):
- Lead with the most relevant info (price, market cap)
- Include token symbol and name
- Note the data source (Jupiter/Pump.fun)
- Add appropriate risk warnings for new/small tokens

**Wallet Response Format** (when discussing smart money):
- List tracked wallets with their labels and categories
- Summarize recent activity when available
- Mention any notable buys or sells
- Add disclaimer that past performance doesn't indicate future results

**Social Signals Features**:
- Twitter/social sentiment analysis via Nitter
- Sentiment scores: bullish (positive), bearish (negative), neutral
- Top tweets by engagement (likes + retweets)
- Common keywords and hashtags
- Tweet count and total engagement metrics

**Social Response Format** (when discussing sentiment):
- Lead with overall sentiment (bullish/bearish/neutral)
- Mention sentiment score if significant
- Share 1-2 notable tweets if available
- List trending keywords/hashtags
- Add disclaimer about social sentiment volatility

If asked about trending, new tokens, safety, whale activity, or social buzz, data will be provided in context.`
  },

  analyzeTrigger: (message: string): TriggerResult | null => {
    for (const pattern of EXPLICIT_PATTERNS) {
      if (pattern.test(message)) {
        return {
          pluginId: 'solana',
          type: 'solana_query',
          confidence: 0.9,
          data: { queryType: detectQueryType(message) },
        }
      }
    }

    const matchCount = GENERAL_PATTERNS.filter((p) => p.test(message)).length
    if (matchCount >= 2) {
      return {
        pluginId: 'solana',
        type: 'solana_query',
        confidence: Math.min(0.5 + matchCount * 0.1, 0.85),
        data: { queryType: detectQueryType(message) },
      }
    }

    return null
  },

  services: {
    async getTrending(): Promise<unknown> {
      return useSolanaStore.getState().fetchTrending()
    },

    async getNewLaunches(): Promise<unknown> {
      return useSolanaStore.getState().fetchNewLaunches()
    },

    async getSolPrice(): Promise<unknown> {
      return useSolanaStore.getState().fetchSolPrice()
    },

    async getToken(mint: unknown): Promise<unknown> {
      if (typeof mint !== 'string') return null
      return useSolanaStore.getState().getToken(mint)
    },

    async getSafety(mint: unknown): Promise<unknown> {
      if (typeof mint !== 'string') return null
      return useSolanaStore.getState().getSafety(mint)
    },

    async getWallets(): Promise<unknown> {
      return useSolanaStore.getState().fetchWallets()
    },

    async getWalletActivity(address: unknown): Promise<unknown> {
      if (typeof address !== 'string') return null
      return useSolanaStore.getState().getWalletActivity(address)
    },

    async getSocial(symbolOrMint: unknown): Promise<unknown> {
      if (typeof symbolOrMint !== 'string') return null
      return useSolanaStore.getState().getSocial(symbolOrMint)
    },
  },
}

export default solanaPlugin
