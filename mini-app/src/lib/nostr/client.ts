import { finalizeEvent, nip44, SimplePool, verifyEvent, type Event, type EventTemplate } from 'nostr-tools'
import { deriveNostrIdentity } from './identity'
import { hash } from '@/helpers/crypto'
import { normalizeContact, rpcEndpoint } from '@/lib/wallet/api'

export type NostrProfile = {
  name?: string
  display_name?: string
  about?: string
  lud16?: string
  lightningAddress?: string
  lnurl?: string
  btcAddress?: string
  taprootAddress?: string
  nostrPublicKey: string
  updatedAt: number
}

export type PaymentPublication = {
  paymentId: string
  paymentHash?: string
  amountSats: number
  method: 'lightning' | 'btc'
  recipientPublicKey?: string
  recipientContact?: string
}

export type ProfileLookup = {
  address: string
  publicKey: string
  btcAddress?: string
  taprootAddress?: string
}

type NostrConfig = {
  relays: string[]
  servicePublicKey: string
}

const DEFAULT_RELAYS = [
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://relay.nostr.net',
  'wss://nostr.bitcoiner.social',
  'wss://relay.nostrcheck.me'
]

const RELAY_TIMEOUT_MS = 5000

let configPromise: Promise<NostrConfig> | null = null

const envRelays = () => (import.meta.env.VITE_NOSTR_RELAYS ?? '')
  .split(',')
  .map(relay => relay.trim())
  .filter(Boolean)

const envServicePublicKey = () => import.meta.env.VITE_NOSTR_SERVICE_PUBKEY?.trim()

const loadConfig = async (): Promise<NostrConfig> => {
  const relays = envRelays()
  const servicePublicKey = envServicePublicKey()

  if (relays.length && servicePublicKey) return { relays, servicePublicKey }

  try {
    const response = await fetch(new URL('/config', rpcEndpoint()))
    if (response.ok) {
      const config = await response.json() as Partial<NostrConfig>
      return {
        relays: relays.length ? relays : (config.relays?.length ? config.relays : DEFAULT_RELAYS),
        servicePublicKey: servicePublicKey ?? config.servicePublicKey ?? ''
      }
    }
  } catch (error) {
    console.warn('Unable to load Nostr configuration from the backend.', error)
  }

  return {
    relays: relays.length ? relays : DEFAULT_RELAYS,
    servicePublicKey: servicePublicKey ?? ''
  }
}

export const getNostrConfig = () => {
  configPromise ??= loadConfig()
  return configPromise
}

const relayReason = (result: PromiseSettledResult<unknown>) => {
  if (result.status === 'fulfilled') return null
  return result.reason instanceof Error ? result.reason.message : String(result.reason)
}

// A relay that already stores the event still satisfies the publish. Some
// relays report that as OK=false with a "duplicate:" reason.
const relayAccepted = (result: PromiseSettledResult<unknown>) => {
  const reason = relayReason(result)
  return reason === null || reason.startsWith('duplicate:')
}

const relayFailureDetails = (relays: string[], results: PromiseSettledResult<unknown>[]) =>
  results
    .map((result, index) => {
      const reason = relayReason(result)
      return `${relays[index] ?? 'unknown relay'}: ${reason === null ? 'accepted' : reason.startsWith('duplicate:') ? 'accepted (duplicate)' : reason}`
    })
    .join('; ')

const publish = async (secretKey: Uint8Array, template: EventTemplate): Promise<Event> => {
  const { relays } = await getNostrConfig()
  if (!relays.length) {
    throw new Error('No Nostr relays are configured.')
  }

  const event = finalizeEvent(template, secretKey)
  const pool = new SimplePool()

  try {
    const results = await Promise.allSettled(pool.publish(relays, event, { maxWait: RELAY_TIMEOUT_MS }))
    if (!results.some(relayAccepted)) {
      throw new Error(`No Nostr relay accepted the event (${relayFailureDetails(relays, results)}).`)
    }
  } finally {
    pool.close(relays)
  }

  return event
}

const latest = (events: Event[]) => events.sort((a, b) => b.created_at - a.created_at)[0]

/**
 * Resolves a Telegram handle (or phone number) to a wallet profile without
 * involving the backend: hash the normalized contact, find the service's
 * verification attestation for that hash, then read the referenced kind 0 profile.
 */
export const lookupProfile = async (contact: string): Promise<ProfileLookup | null> => {
  const config = await getNostrConfig()
  if (!config.servicePublicKey) return null

  const contactHash = await hash(normalizeContact(contact))
  const pool = new SimplePool()

  try {
    const attestations = await pool.querySync(config.relays, {
      kinds: [30078],
      authors: [config.servicePublicKey],
      '#t': ['brio-verified'],
      '#contact': [contactHash],
      limit: 10
    }, { maxWait: RELAY_TIMEOUT_MS })
    const attestation = latest(attestations.filter(verifyEvent))
    const publicKey = attestation?.tags.find(([name]) => name === 'p')?.[1]
    if (!publicKey) return null

    const profiles = await pool.querySync(config.relays, {
      kinds: [0],
      authors: [publicKey],
      limit: 1
    }, { maxWait: RELAY_TIMEOUT_MS })
    const profileEvent = latest(profiles.filter(verifyEvent))
    if (!profileEvent) return null

    let profile: {
      lightningAddress?: string
      lnurl?: string
      lud16?: string
      btcAddress?: string
      taprootAddress?: string
    }
    try {
      profile = JSON.parse(profileEvent.content) as typeof profile
    } catch {
      return null
    }

    const address = profile.lightningAddress ?? profile.lnurl ?? profile.lud16
    if (!address) return null

    return {
      address,
      publicKey,
      btcAddress: profile.btcAddress,
      taprootAddress: profile.taprootAddress
    }
  } finally {
    pool.close(config.relays)
  }
}

export const publishProfile = async (
  mnemonic: string,
  profile: Omit<NostrProfile, 'nostrPublicKey' | 'updatedAt'>,
  contacts: string[]
) => {
  const identity = await deriveNostrIdentity(mnemonic)
  const updatedAt = Math.floor(Date.now() / 1000)
  const content: NostrProfile = {
    ...profile,
    nostrPublicKey: identity.publicKey,
    updatedAt
  }

  return publish(identity.secretKey, {
    kind: 0,
    created_at: updatedAt,
    tags: [
      ['t', 'brio-wallet'],
      ...contacts.map(contact => ['contact', contact])
    ],
    content: JSON.stringify(content)
  })
}

export const publishPayment = async (
  mnemonic: string,
  payment: PaymentPublication
) => {
  const identity = await deriveNostrIdentity(mnemonic)
  const config = await getNostrConfig()
  if (!config.servicePublicKey) {
    throw new Error('The Brio Nostr service public key is not configured.')
  }

  const createdAt = Math.floor(Date.now() / 1000)
  const conversationKey = nip44.v2.utils.getConversationKey(
    identity.secretKey,
    config.servicePublicKey
  )
  const content = {
    paymentId: payment.paymentId,
    paymentHash: payment.paymentHash,
    amountSats: payment.amountSats,
    method: payment.method,
    createdAt
  }
  const tags: string[][] = [
    ['d', `brio:payment:${payment.paymentId}`],
    ['t', 'brio-payment']
  ]
  if (payment.recipientPublicKey) tags.push(['p', payment.recipientPublicKey])
  if (payment.recipientContact) tags.push(['contact', payment.recipientContact])

  return publish(identity.secretKey, {
    kind: 30078,
    created_at: createdAt,
    tags,
    content: nip44.v2.encrypt(JSON.stringify(content), conversationKey)
  })
}
