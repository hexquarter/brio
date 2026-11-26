import { finalizeEvent, nip19 } from 'nostr-tools'
import { deriveNostrIdentity } from '@/lib/nostr/identity'
import { rpcEndpoint } from '@/lib/wallet/api'

/**
 * Client for the npubcash coordinator on the Brio backend. This is the
 * Nostr-native inbound rail: `npub1…@<domain>` Lightning addresses backed by
 * Cashu mint quotes. Authentication is NIP-98 (signed with the wallet's own
 * Nostr identity), so there is no account or API key.
 */

export type NpubcashQuoteState = 'UNPAID' | 'INFLIGHT' | 'PAID' | 'ISSUED'

export type NpubcashQuote = {
  quote: string
  mintUrl: string
  amountSats: number
  invoice: string
  state: NpubcashQuoteState
  createdAt: number
  paidAt?: number
  preimage?: string
  zap: boolean
}

const baseUrl = () => rpcEndpoint()

export const nostrAddressDomain = (): string => new URL(baseUrl()).hostname

/** The Nostr-native Lightning address: npub1…@<backend-domain>. */
export const buildNostrAddress = async (mnemonic: string): Promise<string> => {
  const identity = await deriveNostrIdentity(mnemonic)
  const npub = nip19.npubEncode(identity.publicKey)
  return `${npub}@${nostrAddressDomain()}`
}

// NIP-98: signed kind-27235 event over the exact URL and method.
const nip98Authorization = async (mnemonic: string, url: string, method: string): Promise<string> => {
  const identity = await deriveNostrIdentity(mnemonic)
  const template = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['u', url],
      ['method', method]
    ],
    content: ''
  }
  const event = finalizeEvent(template, identity.secretKey)
  return `Nostr ${btoa(JSON.stringify(event))}`
}

/** Paid (or already issued) mint quotes waiting to be claimed. */
export const fetchNpubcashQuotes = async (mnemonic: string): Promise<NpubcashQuote[]> => {
  const url = `${baseUrl()}/api/v2/wallet/quotes`
  const response = await fetch(url, {
    headers: { Authorization: await nip98Authorization(mnemonic, url, 'GET') }
  })
  if (!response.ok) {
    throw new Error(`Nostr payments request failed (${response.status})`)
  }
  return await response.json() as NpubcashQuote[]
}

export type NpubcashInfo = {
  version: number
  mint: string
  features: { username: { enabled: boolean } }
}

/** Public coordinator info (includes the default Cashu mint URL). */
export const fetchNpubcashInfo = async (): Promise<NpubcashInfo | null> => {
  try {
    const response = await fetch(`${baseUrl()}/api/v2/info`)
    if (!response.ok) return null
    return await response.json() as NpubcashInfo
  } catch (error) {
    console.warn('Unable to load the coordinator info:', error)
    return null
  }
}
