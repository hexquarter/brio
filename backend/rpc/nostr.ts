import {
  finalizeEvent,
  getPublicKey,
  nip19,
  nip44,
  SimplePool,
  verifyEvent,
  type Event,
  type EventTemplate,
  type Filter
} from 'nostr-tools'
import type { Env } from '../env.js'

export type VerifiedClient = {
  chatId: string
  username?: string
  nostrPublicKey: string
  profileEventId: string
  verifiedAt: number
}

export type PaymentRecord = {
  paymentId: string
  paymentHash?: string
  amountSats: number
  method: 'lightning' | 'btc'
  createdAt: number
}

const encoder = new TextEncoder()
const RELAY_TIMEOUT_MS = 5000

const hexToBytes = (input: string) =>
  Uint8Array.from(input.match(/.{2}/g) ?? [], byte => parseInt(byte, 16))

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')

export const getRelays = (env: Env) => {
  const relays = env.NOSTR_RELAYS?.split(',').map(relay => relay.trim()).filter(Boolean)
  if (!relays?.length) throw new Error('NOSTR_RELAYS must contain at least one relay URL.')
  return relays
}

const getSecretKey = (env: Env) => {
  const configuredKey = env.NOSTR_PRIVATE_KEY
  if (!configuredKey) throw new Error('NOSTR_PRIVATE_KEY is not configured.')

  if (/^[0-9a-f]{64}$/i.test(configuredKey)) return hexToBytes(configuredKey)

  const decoded = nip19.decode(configuredKey)
  if (decoded.type !== 'nsec') throw new Error('NOSTR_PRIVATE_KEY must be an nsec or 32-byte hex secret.')
  return decoded.data
}

export const getServicePublicKey = (env: Env) => getPublicKey(getSecretKey(env))

const encryptForService = (env: Env, content: object) => {
  const secretKey = getSecretKey(env)
  const conversationKey = nip44.v2.utils.getConversationKey(secretKey, getPublicKey(secretKey))
  return nip44.v2.encrypt(JSON.stringify(content), conversationKey)
}

const decryptWithService = (env: Env, content: string, senderPublicKey: string) => {
  const conversationKey = nip44.v2.utils.getConversationKey(getSecretKey(env), senderPublicKey)
  return JSON.parse(nip44.v2.decrypt(content, conversationKey)) as Record<string, unknown>
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

const publishToRelays = async (env: Env, event: Event) => {
  const relays = getRelays(env)
  const pool = new SimplePool()
  try {
    const results = await Promise.allSettled(pool.publish(relays, event, { maxWait: RELAY_TIMEOUT_MS }))
    if (!results.some(relayAccepted)) {
      throw new Error(`No Nostr relay accepted the event (${relayFailureDetails(relays, results)}).`)
    }
  } finally {
    pool.close(relays)
  }
}

export const publishEvent = async (env: Env, template: EventTemplate) => {
  const event = finalizeEvent(template, getSecretKey(env))
  await publishToRelays(env, event)
  return event
}

export const queryEvents = async (env: Env, filter: Filter) => {
  const relays = getRelays(env)
  const pool = new SimplePool()
  try {
    const events = await pool.querySync(relays, filter, { maxWait: RELAY_TIMEOUT_MS })
    return events.filter(verifyEvent)
  } finally {
    pool.close(relays)
  }
}

export const getEventById = async (env: Env, id: string): Promise<Event | null> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const events = await queryEvents(env, { ids: [id], limit: 1 })
    const event = events.find(candidate => candidate.id === id)
    if (event) return event
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 750))
  }
  return null
}

export const hashContact = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return bytesToHex(new Uint8Array(digest))
}

const tagValues = (event: Event, name: string) =>
  event.tags.filter(([tag]) => tag === name).map(([, value]) => value).filter(Boolean)

const tagValue = (event: Event, name: string) => tagValues(event, name)[0]

const latestServiceEvent = (env: Env, events: Event[]) => {
  const servicePublicKey = getServicePublicKey(env)
  return events
    .filter(event => event.pubkey === servicePublicKey)
    .sort((a, b) => b.created_at - a.created_at)[0]
}

export const publishAttestation = async (
  env: Env,
  input: {
    chatId: string
    username?: string
    nostrPublicKey: string
    profileEventId: string
    contacts: string[]
  }
) => {
  const content: VerifiedClient = {
    chatId: input.chatId,
    username: input.username,
    nostrPublicKey: input.nostrPublicKey,
    profileEventId: input.profileEventId,
    verifiedAt: Math.floor(Date.now() / 1000)
  }

  return publishEvent(env, {
    kind: 30078,
    created_at: content.verifiedAt,
    tags: [
      ['d', `brio:verified:${input.nostrPublicKey}`],
      ['p', input.nostrPublicKey],
      ['e', input.profileEventId],
      ['t', 'brio-verified'],
      ...input.contacts.map(contact => ['contact', contact])
    ],
    content: encryptForService(env, content)
  })
}

export const findAttestationByContact = async (env: Env, contact: string) => {
  const events = await queryEvents(env, {
    kinds: [30078],
    '#t': ['brio-verified'],
    '#contact': [contact],
    limit: 10
  })
  return latestServiceEvent(env, events) ?? null
}

export const findAttestationByPubkey = async (env: Env, publicKey: string) => {
  const events = await queryEvents(env, {
    kinds: [30078],
    authors: [getServicePublicKey(env)],
    '#t': ['brio-verified'],
    '#p': [publicKey],
    limit: 10
  })
  return latestServiceEvent(env, events) ?? null
}

export const readAttestation = (env: Env, event: Event): VerifiedClient => {
  const content = decryptWithService(env, event.content, event.pubkey)
  return {
    chatId: String(content.chatId),
    username: typeof content.username === 'string' ? content.username : undefined,
    nostrPublicKey: String(content.nostrPublicKey),
    profileEventId: String(content.profileEventId),
    verifiedAt: Number(content.verifiedAt)
  }
}

export const getPaymentEvent = async (env: Env, id: string) => {
  const event = await getEventById(env, id)
  if (!event || event.kind !== 30078) return null
  if (!event.tags.some(([name, value]) => name === 't' && value === 'brio-payment')) return null
  return event
}

export const readPayment = (env: Env, event: Event): PaymentRecord => {
  const content = decryptWithService(env, event.content, event.pubkey)
  return {
    paymentId: String(content.paymentId),
    paymentHash: typeof content.paymentHash === 'string' ? content.paymentHash : undefined,
    amountSats: Number(content.amountSats),
    method: content.method === 'btc' ? 'btc' : 'lightning',
    createdAt: Number(content.createdAt)
  }
}

export const getPaymentRecipient = (event: Event) => ({
  publicKey: tagValue(event, 'p'),
  contact: tagValue(event, 'contact')
})
