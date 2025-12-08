/**
 * Solana Store
 *
 * Zustand store for Solana memecoin intelligence data.
 * Fetches from Hub API and caches locally.
 */

import { create } from 'zustand'
import { createLogger } from '../core/debug'
import type {
  SolanaToken,
  TrendingToken,
  NewLaunch,
  TrendingResponse,
  NewLaunchesResponse,
  TokenResponse,
  SolPriceResponse,
  TokenSafety,
  SafetyResponse,
  SmartMoneyWallet,
  WalletActivity,
  WalletsResponse,
  WalletActivityResponse,
  SocialSignal,
  SocialResponse,
} from './solana.types'

const log = createLogger('SolanaStore')

interface SolanaState {
  trending: TrendingToken[]
  trendingLoading: boolean
  trendingError: string | null
  trendingFetchedAt: number | null

  newLaunches: NewLaunch[]
  launchesLoading: boolean
  launchesError: string | null
  launchesFetchedAt: number | null

  solPrice: number | null
  solPriceFetchedAt: number | null

  wallets: SmartMoneyWallet[]
  walletsLoading: boolean
  walletsError: string | null
  walletsFetchedAt: number | null

  tokenCache: Map<string, SolanaToken>
  safetyCache: Map<string, TokenSafety>
  walletActivityCache: Map<string, WalletActivity>
  socialCache: Map<string, SocialSignal>

  fetchTrending: () => Promise<TrendingToken[]>
  fetchNewLaunches: () => Promise<NewLaunch[]>
  fetchSolPrice: () => Promise<number | null>
  fetchWallets: () => Promise<SmartMoneyWallet[]>
  getToken: (mint: string) => Promise<SolanaToken | null>
  getSafety: (mint: string) => Promise<TokenSafety | null>
  getWalletActivity: (address: string) => Promise<WalletActivity | null>
  getSocial: (symbolOrMint: string) => Promise<SocialSignal | null>
  clearCache: () => void
}

const TRENDING_CACHE_TTL = 5 * 60 * 1000
const LAUNCHES_CACHE_TTL = 2 * 60 * 1000
const TOKEN_CACHE_TTL = 60 * 1000
const SAFETY_CACHE_TTL = 5 * 60 * 1000
const WALLETS_CACHE_TTL = 10 * 60 * 1000
const WALLET_ACTIVITY_CACHE_TTL = 2 * 60 * 1000
const SOCIAL_CACHE_TTL = 5 * 60 * 1000

export const useSolanaStore = create<SolanaState>()((set, get) => ({
  trending: [],
  trendingLoading: false,
  trendingError: null,
  trendingFetchedAt: null,

  newLaunches: [],
  launchesLoading: false,
  launchesError: null,
  launchesFetchedAt: null,

  solPrice: null,
  solPriceFetchedAt: null,

  wallets: [],
  walletsLoading: false,
  walletsError: null,
  walletsFetchedAt: null,

  tokenCache: new Map(),
  safetyCache: new Map(),
  walletActivityCache: new Map(),
  socialCache: new Map(),

  fetchTrending: async () => {
    const { trendingFetchedAt, trending } = get()

    if (trendingFetchedAt && Date.now() - trendingFetchedAt < TRENDING_CACHE_TTL) {
      log.log('Using cached trending data')
      return trending
    }

    set({ trendingLoading: true, trendingError: null })

    try {
      const response = await fetchSolanaAPI<TrendingResponse>('/v1/solana/trending')
      if (response.success) {
        set({
          trending: response.data,
          trendingFetchedAt: Date.now(),
          trendingLoading: false,
        })
        log.log('Fetched trending:', response.data.length, 'tokens')
        return response.data
      }
      throw new Error('API returned unsuccessful response')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch trending'
      log.error('Failed to fetch trending:', err)
      set({
        trendingError: errorMsg,
        trendingLoading: false,
      })
      return []
    }
  },

  fetchNewLaunches: async () => {
    const { launchesFetchedAt, newLaunches } = get()

    if (launchesFetchedAt && Date.now() - launchesFetchedAt < LAUNCHES_CACHE_TTL) {
      log.log('Using cached launches data')
      return newLaunches
    }

    set({ launchesLoading: true, launchesError: null })

    try {
      const response = await fetchSolanaAPI<NewLaunchesResponse>('/v1/solana/new-launches')
      if (response.success) {
        set({
          newLaunches: response.data,
          launchesFetchedAt: Date.now(),
          launchesLoading: false,
        })
        log.log('Fetched new launches:', response.data.length, 'tokens')
        return response.data
      }
      throw new Error('API returned unsuccessful response')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch launches'
      log.error('Failed to fetch new launches:', err)
      set({
        launchesError: errorMsg,
        launchesLoading: false,
      })
      return []
    }
  },

  fetchSolPrice: async () => {
    try {
      const response = await fetchSolanaAPI<SolPriceResponse>('/v1/solana/sol-price')
      if (response.success) {
        set({
          solPrice: response.data.priceUsd,
          solPriceFetchedAt: Date.now(),
        })
        return response.data.priceUsd
      }
      return null
    } catch (err) {
      log.error('Failed to fetch SOL price:', err)
      return null
    }
  },

  getToken: async (mint: string) => {
    const { tokenCache } = get()

    const cached = tokenCache.get(mint)
    if (cached && Date.now() - cached.fetchedAt < TOKEN_CACHE_TTL) {
      return cached
    }

    try {
      const response = await fetchSolanaAPI<TokenResponse>(`/v1/solana/token/${mint}`)
      if (response.success) {
        const newCache = new Map(tokenCache)
        newCache.set(mint, response.data)
        set({ tokenCache: newCache })
        return response.data
      }
      return null
    } catch (err) {
      log.error('Failed to fetch token:', err)
      return null
    }
  },

  getSafety: async (mint: string) => {
    const { safetyCache } = get()

    const cached = safetyCache.get(mint)
    if (cached && Date.now() - cached.analyzedAt < SAFETY_CACHE_TTL) {
      log.log('Using cached safety data for', mint.slice(0, 8))
      return cached
    }

    try {
      const response = await fetchSolanaAPI<SafetyResponse>(`/v1/solana/safety/${mint}`)
      if (response.success) {
        const newCache = new Map(safetyCache)
        newCache.set(mint, response.data)
        set({ safetyCache: newCache })
        log.log('Fetched safety for', mint.slice(0, 8), '- score:', response.data.score)
        return response.data
      }
      return null
    } catch (err) {
      log.error('Failed to fetch safety:', err)
      return null
    }
  },

  fetchWallets: async () => {
    const { walletsFetchedAt, wallets } = get()

    if (walletsFetchedAt && Date.now() - walletsFetchedAt < WALLETS_CACHE_TTL) {
      log.log('Using cached wallets data')
      return wallets
    }

    set({ walletsLoading: true, walletsError: null })

    try {
      const response = await fetchSolanaAPI<WalletsResponse>('/v1/solana/wallets')
      if (response.success) {
        set({
          wallets: response.data,
          walletsFetchedAt: Date.now(),
          walletsLoading: false,
        })
        log.log('Fetched wallets:', response.data.length, 'addresses')
        return response.data
      }
      throw new Error('API returned unsuccessful response')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch wallets'
      log.error('Failed to fetch wallets:', err)
      set({
        walletsError: errorMsg,
        walletsLoading: false,
      })
      return []
    }
  },

  getWalletActivity: async (address: string) => {
    const { walletActivityCache } = get()

    const cached = walletActivityCache.get(address)
    if (cached && Date.now() - cached.fetchedAt < WALLET_ACTIVITY_CACHE_TTL) {
      log.log('Using cached activity for', address.slice(0, 8))
      return cached
    }

    try {
      const response = await fetchSolanaAPI<WalletActivityResponse>(`/v1/solana/wallet/${address}/activity`)
      if (response.success) {
        const newCache = new Map(walletActivityCache)
        newCache.set(address, response.data)
        set({ walletActivityCache: newCache })
        log.log('Fetched activity for', address.slice(0, 8), '-', response.data.recentTransactions.length, 'txs')
        return response.data
      }
      return null
    } catch (err) {
      log.error('Failed to fetch wallet activity:', err)
      return null
    }
  },

  getSocial: async (symbolOrMint: string) => {
    const { socialCache } = get()

    const cached = socialCache.get(symbolOrMint.toLowerCase())
    if (cached && Date.now() - cached.fetchedAt < SOCIAL_CACHE_TTL) {
      log.log('Using cached social data for', symbolOrMint)
      return cached
    }

    try {
      const response = await fetchSolanaAPI<SocialResponse>(`/v1/solana/social/${symbolOrMint}`)
      if (response.success) {
        const newCache = new Map(socialCache)
        newCache.set(symbolOrMint.toLowerCase(), response.data)
        set({ socialCache: newCache })
        log.log('Fetched social for', symbolOrMint, '- sentiment:', response.data.sentiment)
        return response.data
      }
      return null
    } catch (err) {
      log.error('Failed to fetch social:', err)
      return null
    }
  },

  clearCache: () => {
    set({
      trending: [],
      trendingFetchedAt: null,
      newLaunches: [],
      launchesFetchedAt: null,
      wallets: [],
      walletsFetchedAt: null,
      tokenCache: new Map(),
      safetyCache: new Map(),
      walletActivityCache: new Map(),
      socialCache: new Map(),
    })
    log.log('Cache cleared')
  },
}))

/**
 * Fetch from Hub API with auth
 */
async function fetchSolanaAPI<T>(path: string): Promise<T> {
  const settingsData = await chrome.storage.local.get('settings-store')
  let settings: Record<string, unknown> | undefined

  if (typeof settingsData?.['settings-store'] === 'string') {
    settings = JSON.parse(settingsData['settings-store'])
  } else {
    settings = settingsData?.['settings-store'] as Record<string, unknown> | undefined
  }

  const state = settings?.state as Record<string, unknown> | undefined
  const hubUrl = state?.hubUrl as string | undefined
  const hubAccessToken = state?.hubAccessToken as string | undefined

  if (!hubUrl || !hubAccessToken) {
    throw new Error('Hub not connected')
  }

  const response = await fetch(`${hubUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${hubAccessToken}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`)
  }

  return response.json()
}
