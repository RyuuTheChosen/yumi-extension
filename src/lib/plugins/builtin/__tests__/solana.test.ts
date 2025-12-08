import { describe, it, expect } from 'vitest'
import { solanaPlugin } from '../solana'

describe('solanaPlugin', () => {
  describe('manifest', () => {
    it('has correct plugin ID', () => {
      expect(solanaPlugin.manifest.id).toBe('solana')
    })

    it('has required manifest fields', () => {
      expect(solanaPlugin.manifest.name).toBeDefined()
      expect(solanaPlugin.manifest.description).toBeDefined()
      expect(solanaPlugin.manifest.version).toBeDefined()
    })
  })

  describe('getPromptAdditions', () => {
    it('returns prompt additions string', () => {
      const additions = solanaPlugin.getPromptAdditions?.({} as never)
      expect(typeof additions).toBe('string')
      expect(additions).toContain('Solana')
    })

    it('includes safety analysis instructions', () => {
      const additions = solanaPlugin.getPromptAdditions?.({} as never)
      expect(additions).toContain('Safety Analysis')
      expect(additions).toContain('score')
    })

    it('includes wallet tracking instructions', () => {
      const additions = solanaPlugin.getPromptAdditions?.({} as never)
      expect(additions).toContain('Wallet')
      expect(additions).toContain('whale')
    })

    it('includes social signals instructions', () => {
      const additions = solanaPlugin.getPromptAdditions?.({} as never)
      expect(additions).toContain('Social')
      expect(additions).toContain('sentiment')
    })
  })

  describe('analyzeTrigger', () => {
    describe('explicit patterns', () => {
      it('triggers on "solana trending" query', () => {
        const result = solanaPlugin.analyzeTrigger?.('What is solana trending right now?')
        expect(result).not.toBeNull()
        expect(result?.pluginId).toBe('solana')
        expect(result?.confidence).toBeGreaterThanOrEqual(0.9)
      })

      it('triggers on "pump.fun trending" query', () => {
        const result = solanaPlugin.analyzeTrigger?.('Show me what is trending on pump.fun')
        expect(result).not.toBeNull()
        expect(result?.confidence).toBeGreaterThanOrEqual(0.9)
      })

      it('triggers on safety check queries', () => {
        const result = solanaPlugin.analyzeTrigger?.('Is this token safe?')
        expect(result).not.toBeNull()
        expect(result?.data?.queryType).toBe('safety')
      })

      it('triggers on rug check queries', () => {
        const result = solanaPlugin.analyzeTrigger?.('Check if this is a rug pull')
        expect(result).not.toBeNull()
        expect(result?.data?.queryType).toBe('safety')
      })

      it('triggers on whale activity queries', () => {
        const result = solanaPlugin.analyzeTrigger?.('What are whales buying?')
        expect(result).not.toBeNull()
        expect(result?.data?.queryType).toBe('wallets')
      })

      it('triggers on smart money queries', () => {
        const result = solanaPlugin.analyzeTrigger?.('Track smart money activity')
        expect(result).not.toBeNull()
        expect(result?.data?.queryType).toBe('wallets')
      })

      it('triggers on social sentiment queries', () => {
        const result = solanaPlugin.analyzeTrigger?.('What is the buzz on $BONK?')
        expect(result).not.toBeNull()
        expect(result?.data?.queryType).toBe('social')
      })

      it('triggers on twitter sentiment queries', () => {
        const result = solanaPlugin.analyzeTrigger?.('What is twitter saying about this token?')
        expect(result).not.toBeNull()
        expect(result?.data?.queryType).toBe('social')
      })

      it('triggers on new launches queries', () => {
        const result = solanaPlugin.analyzeTrigger?.('Show me new launches on pump.fun')
        expect(result).not.toBeNull()
        expect(result?.confidence).toBeGreaterThanOrEqual(0.9)
      })
    })

    describe('general patterns', () => {
      it('triggers with medium confidence on multiple crypto terms', () => {
        const result = solanaPlugin.analyzeTrigger?.('any thoughts on that raydium token pumping?')
        expect(result).not.toBeNull()
        expect(result?.confidence).toBeLessThanOrEqual(0.85)
        expect(result?.confidence).toBeGreaterThanOrEqual(0.5)
      })

      it('triggers on token ticker mentions', () => {
        const result = solanaPlugin.analyzeTrigger?.('What do you think about $BONK on solana?')
        expect(result).not.toBeNull()
      })

      it('does not trigger on single crypto term', () => {
        const result = solanaPlugin.analyzeTrigger?.('I like solana')
        expect(result).toBeNull()
      })

      it('does not trigger on unrelated messages', () => {
        const result = solanaPlugin.analyzeTrigger?.('What is the weather today?')
        expect(result).toBeNull()
      })
    })

    describe('query type detection', () => {
      it('detects safety query type', () => {
        const result = solanaPlugin.analyzeTrigger?.('Is this token safe or a scam?')
        expect(result).not.toBeNull()
        expect(result?.data?.queryType).toBe('safety')
      })

      it('detects wallets query type', () => {
        const result = solanaPlugin.analyzeTrigger?.('What are the whales buying on solana?')
        expect(result).not.toBeNull()
        expect(result?.data?.queryType).toBe('wallets')
      })

      it('detects social query type', () => {
        const result = solanaPlugin.analyzeTrigger?.('What is the buzz on $BONK?')
        expect(result).not.toBeNull()
        expect(result?.data?.queryType).toBe('social')
      })

      it('detects trending query type', () => {
        const result = solanaPlugin.analyzeTrigger?.('What is trending on solana?')
        expect(result).not.toBeNull()
        expect(result?.data?.queryType).toBe('trending')
      })

      it('detects new_launches query type', () => {
        const result = solanaPlugin.analyzeTrigger?.('Show me new launches on solana')
        expect(result).not.toBeNull()
        expect(result?.data?.queryType).toBe('new_launches')
      })

      it('detects price query type', () => {
        const result = solanaPlugin.analyzeTrigger?.('Check the solana token price')
        expect(result).not.toBeNull()
        expect(result?.data?.queryType).toBe('price')
      })

      it('detects token_lookup query type', () => {
        const result = solanaPlugin.analyzeTrigger?.('Show me solana $BONK info')
        expect(result).not.toBeNull()
        expect(result?.data?.queryType).toBe('token_lookup')
      })
    })
  })

  describe('services', () => {
    it('has getTrending service', () => {
      expect(solanaPlugin.services?.getTrending).toBeDefined()
      expect(typeof solanaPlugin.services?.getTrending).toBe('function')
    })

    it('has getNewLaunches service', () => {
      expect(solanaPlugin.services?.getNewLaunches).toBeDefined()
      expect(typeof solanaPlugin.services?.getNewLaunches).toBe('function')
    })

    it('has getSolPrice service', () => {
      expect(solanaPlugin.services?.getSolPrice).toBeDefined()
      expect(typeof solanaPlugin.services?.getSolPrice).toBe('function')
    })

    it('has getToken service', () => {
      expect(solanaPlugin.services?.getToken).toBeDefined()
      expect(typeof solanaPlugin.services?.getToken).toBe('function')
    })

    it('has getSafety service', () => {
      expect(solanaPlugin.services?.getSafety).toBeDefined()
      expect(typeof solanaPlugin.services?.getSafety).toBe('function')
    })

    it('has getWallets service', () => {
      expect(solanaPlugin.services?.getWallets).toBeDefined()
      expect(typeof solanaPlugin.services?.getWallets).toBe('function')
    })

    it('has getWalletActivity service', () => {
      expect(solanaPlugin.services?.getWalletActivity).toBeDefined()
      expect(typeof solanaPlugin.services?.getWalletActivity).toBe('function')
    })

    it('has getSocial service', () => {
      expect(solanaPlugin.services?.getSocial).toBeDefined()
      expect(typeof solanaPlugin.services?.getSocial).toBe('function')
    })

    it('getToken returns null for non-string input', async () => {
      const result = await solanaPlugin.services?.getToken?.(123)
      expect(result).toBeNull()
    })

    it('getSafety returns null for non-string input', async () => {
      const result = await solanaPlugin.services?.getSafety?.(null)
      expect(result).toBeNull()
    })

    it('getWalletActivity returns null for non-string input', async () => {
      const result = await solanaPlugin.services?.getWalletActivity?.(undefined)
      expect(result).toBeNull()
    })

    it('getSocial returns null for non-string input', async () => {
      const result = await solanaPlugin.services?.getSocial?.({})
      expect(result).toBeNull()
    })
  })
})
