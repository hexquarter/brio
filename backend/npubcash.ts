import { nip19, SimplePool, verifyEvent, type Event } from 'nostr-tools'
import type { Env } from './env.js'
import { json } from './http.js'
import { getCashuMintUrl, createMintQuote, getMintQuote } from './cashu.js'
import { getRelays, publishEvent, getServicePublicKey } from './rpc/nostr.js'

/**
 * npubcash-compatible coordinator: a Nostr-native inbound rail for Brio.
 *
 * Any Nostr client can pay `npub1…@<worker-domain>` over Lightning. The
 * coordinator turns the payment into a bolt11 mint quote at the configured
 * Cashu mint and records the paid quote for the recipient's Nostr key. The
 * recipient's wallet (this mini-app, cashu.me, ...) retrieves the paid quote
 * and mints the ecash proofs directly against the mint — the coordinator
 * never holds funds or ecash.
 *
 * Payment flow:
 *   1. GET /.well-known/lnurlp/<npub|hex>            -> discovery
 *   2. GET /.well-known/lnurlp/<user>?amount=<msat>  -> invoice (mint quote)
 *      [&nostr=<zap request>]  (NIP-57, receipt published once paid)
 *   3. GET /lnurl/verify/<quote>                     -> payment status
 *   4. GET /api/v2/wallet/quotes (NIP-98 auth)       -> paid quotes to claim
 *
 * KV layout (BRIO_KV):
 *   npc:quote:<quoteId>          -> QuoteRecord
 *   npc:idx:<pubkey>:<quoteId>   -> quote index per recipient
 *   npc:user:<pubkey>            -> { mintUrl? } recipient mint preference
 */

const QUOTE_KEY_PREFIX = 'npc:quote:'
const INDEX_KEY_PREFIX = 'npc:idx:'
const USER_KEY_PREFIX = 'npc:user:'

const MIN_SEND_MSAT = 1000
const MAX_SEND_MSAT = 100_000_000
const LNURLP_PATTERN = /^[0-9a-f]{64}$|^(npub1|nprofile1)[02-9ac-hj-np-z]+$/

type QuoteState = 'UNPAID' | 'INFLIGHT' | 'PAID' | 'ISSUED'

type QuoteRecord = {
  quote: string
  pubkey: string
  mintUrl: string
  amountSats: number
  invoice: string
  state: QuoteState
  createdAt: number
  paidAt?: number
  preimage?: string
  // Raw NIP-57 zap request (the `nostr` query parameter). The description
  // hash of the invoice commits to exactly this string.
  zapRequest?: string
  receiptPublished?: boolean
}

export type WalletQuote = {
  quote: string
  mintUrl: string
  amountSats: number
  invoice: string
  state: QuoteState
  createdAt: number
  paidAt?: number
  preimage?: string
  zap: boolean
}

// ---------------------------------------------------------------- KV store

const readQuote = async (env: Env, quoteId: string): Promise<QuoteRecord | null> => {
  if (!env.BRIO_KV) return null
  const raw = await env.BRIO_KV.get(`${QUOTE_KEY_PREFIX}${quoteId}`)
  return raw ? (JSON.parse(raw) as QuoteRecord) : null
}

const writeQuote = async (env: Env, record: QuoteRecord) => {
  if (!env.BRIO_KV) return
  await env.BRIO_KV.put(`${QUOTE_KEY_PREFIX}${record.quote}`, JSON.stringify(record), {
    expirationTtl: 60 * 60 * 24 * 90
  })
  await env.BRIO_KV.put(`${INDEX_KEY_PREFIX}${record.pubkey}:${record.quote}`, '1', {
    expirationTtl: 60 * 60 * 24 * 90
  })
}

const listUserQuoteIds = async (env: Env, pubkey: string): Promise<string[]> => {
  if (!env.BRIO_KV) return []
  const ids: string[] = []
  let cursor: string | undefined
  do {
    const page = await env.BRIO_KV.list({ prefix: `${INDEX_KEY_PREFIX}${pubkey}:`, cursor })
    for (const key of page.keys) {
      ids.push(key.name.slice(INDEX_KEY_PREFIX.length + pubkey.length + 1))
    }
    cursor = page.list_complete ? undefined : (page as { cursor: string }).cursor
  } while (cursor)
  return ids
}

const readMintPreference = async (env: Env, pubkey: string): Promise<string | undefined> => {
  if (!env.BRIO_KV) return undefined
  const raw = await env.BRIO_KV.get(`${USER_KEY_PREFIX}${pubkey}`)
  if (!raw) return undefined
  try {
    return (JSON.parse(raw) as { mintUrl?: string }).mintUrl
  } catch {
    return undefined
  }
}

// --------------------------------------------------------------- identity

const resolveUser = (input: string): string | null => {
  const value = input.trim().toLowerCase()
  if (/^[0-9a-f]{64}$/.test(value)) return value
  try {
    const decoded = nip19.decode(value)
    if (decoded.type === 'npub') return decoded.data as string
    if (decoded.type === 'nprofile') return (decoded.data as { pubkey: string }).pubkey
  } catch {
    // Not a valid Nostr identifier.
  }
  return null
}

const shortNpub = (pubkey: string): string => {
  try {
    const npub = nip19.npubEncode(pubkey)
    return `${npub.slice(0, 12)}…${npub.slice(-6)}`
  } catch {
    return pubkey.slice(0, 12)
  }
}

// ------------------------------------------------------------------ NIP-98

const decodeNip98 = (header: string): Event | null => {
  if (!header.startsWith('Nostr ')) return null
  try {
    const event = JSON.parse(atob(header.slice(6))) as Event
    return verifyEvent(event) ? event : null
  } catch {
    return null
  }
}

const nip98Failure = (reason: string) =>
  json({ error: reason }, 401, { 'WWW-Authenticate': 'Nostr realm="npubcash"' })

// NIP-98: kind 27235, `u` (url) and `method` tags must match the request.
export const authenticateNip98 = async (
  request: Request,
  expectedMethod: string
): Promise<{ event: Event; pubkey: string } | Response> => {
  const header = request.headers.get('Authorization') ?? ''
  const event = decodeNip98(header)
  if (!event) return nip98Failure('invalid NIP-98 token')
  if (event.kind !== 27235) return nip98Failure('wrong event kind')

  const age = Math.floor(Date.now() / 1000) - event.created_at
  if (Math.abs(age) > 120) return nip98Failure('stale NIP-98 token')

  const url = new URL(request.url)
  const uTag = event.tags.find(([name]) => name === 'u')?.[1]
  const methodTag = event.tags.find(([name]) => name === 'method')?.[1]
  if (!uTag || !methodTag) return nip98Failure('missing u/method tags')
  if (methodTag.toUpperCase() !== expectedMethod.toUpperCase()) {
    return nip98Failure('method mismatch')
  }
  try {
    const tagged = new URL(uTag)
    if (tagged.origin !== url.origin || tagged.pathname !== url.pathname) {
      return nip98Failure('url mismatch')
    }
  } catch {
    return nip98Failure('invalid u tag')
  }

  return { event, pubkey: event.pubkey }
}

// ------------------------------------------------------------- NIP-57 zaps

const validateZapRequest = (
  raw: string,
  recipientPubkey: string,
  amountMsat: number
): { ok: true; request: Event } | { ok: false; reason: string } => {
  let request: Event
  try {
    request = JSON.parse(raw) as Event
  } catch {
    return { ok: false, reason: 'zap request is not valid JSON' }
  }
  if (!verifyEvent(request)) return { ok: false, reason: 'zap request signature invalid' }
  if (request.kind !== 9734) return { ok: false, reason: 'zap request must be kind 9734' }
  if (!request.tags.some(([name, value]) => name === 'p' && value === recipientPubkey)) {
    return { ok: false, reason: 'zap request recipient mismatch' }
  }
  const amount = request.tags.find(([name]) => name === 'amount')?.[1]
  if (!amount || Number(amount) !== amountMsat) {
    return { ok: false, reason: 'zap request amount mismatch' }
  }
  if (Math.abs(Math.floor(Date.now() / 1000) - request.created_at) > 10 * 60) {
    return { ok: false, reason: 'zap request is stale' }
  }
  return { ok: true, request }
}

const zapReceiptRelays = (env: Env, request: Event): string[] => {
  const relays = request.tags
    .filter(([name]) => name === 'relays')
    .flatMap(([, ...values]) => values)
    .filter(value => value.startsWith('wss://') || value.startsWith('ws://'))
  if (relays.length) return relays
  try {
    return getRelays(env)
  } catch {
    return []
  }
}

const publishZapReceipt = async (env: Env, record: QuoteRecord, request: Event) => {
  const recipient = request.tags.find(([name]) => name === 'p')?.[1] ?? record.pubkey
  const tags: string[][] = [
    ['p', recipient],
    ['P', request.pubkey],
    ['description', record.zapRequest ?? ''],
    ['bolt11', record.invoice]
  ]
  if (record.preimage) tags.push(['preimage', record.preimage])

  const event = await publishEvent(env, {
    kind: 9735,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: ''
  })

  // Receipts go to the relays named in the zap request, when present.
  const relays = zapReceiptRelays(env, request)
  if (relays.length) {
    // publishEvent already wrote to the configured relays; republishing to
    // the requester's relay set is best-effort and must never throw.
    try {
      const pool = new SimplePool()
      try {
        await Promise.allSettled(pool.publish(relays, event, { maxWait: 4000 }))
      } finally {
        pool.close(relays)
      }
    } catch (error) {
      console.warn('Unable to publish the zap receipt to the request relays:', error)
    }
  }
  return event
}

// ------------------------------------------------------------------- LNURL

const METADATA = (identifier: string) => JSON.stringify([
  ['text/plain', 'Brio Bitcoin wallet'],
  ['text/identifier', identifier]
])

const lnurlpCallback = (url: URL, user: string) =>
  `${url.origin}/.well-known/lnurlp/${user}`

export const handleLnurlPay = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url)
  const user = decodeURIComponent(url.pathname.split('/').pop() ?? '')
  if (!LNURLP_PATTERN.test(user)) {
    return json({ status: 'ERROR', reason: 'Only npub addresses are supported for now' }, 400)
  }
  const pubkey = resolveUser(user)
  if (!pubkey) return json({ status: 'ERROR', reason: 'invalid npub' }, 400)

  const identifier = `${nip19.npubEncode(pubkey)}@${url.hostname}`
  const amount = url.searchParams.get('amount')

  // Discovery response.
  if (!amount) {
    const discovery: Record<string, unknown> = {
      tag: 'payRequest',
      callback: lnurlpCallback(url, user),
      metadata: METADATA(identifier),
      minSendable: MIN_SEND_MSAT,
      maxSendable: MAX_SEND_MSAT,
      allowsNostr: true
    }
    try {
      discovery.nostrPubkey = getServicePublicKey(env)
    } catch {
      // Zap receipts are unavailable without the service key.
    }
    return json(discovery, 200, { 'Cache-Control': 'no-cache' })
  }

  // Invoice request.
  const amountMsat = Number(amount)
  if (!Number.isInteger(amountMsat) || amountMsat < MIN_SEND_MSAT || amountMsat > MAX_SEND_MSAT) {
    return json({ status: 'ERROR', reason: 'amount out of range' }, 400)
  }
  const amountSats = Math.floor(amountMsat / 1000)
  if (amountSats < 1) return json({ status: 'ERROR', reason: 'amount below 1 sat' }, 400)

  if (!env.BRIO_KV) {
    return json({ status: 'ERROR', reason: 'payment coordinator is not configured' }, 503)
  }

  let description: string | undefined
  let zapRequest: string | undefined
  const nostrParam = url.searchParams.get('nostr')
  if (nostrParam) {
    const validated = validateZapRequest(nostrParam, pubkey, amountMsat)
    if (!validated.ok) {
      return json({ status: 'ERROR', reason: validated.reason }, 400)
    }
    zapRequest = nostrParam
    description = nostrParam
  } else {
    description = `Brio payment to ${shortNpub(pubkey)}`
  }

  const mintUrl = (await readMintPreference(env, pubkey)) ?? getCashuMintUrl(env)
  let created: Awaited<ReturnType<typeof createMintQuote>>
  try {
    created = await createMintQuote(env, { amountSats, description, mintUrl })
  } catch (error) {
    console.error('Unable to create the mint quote:', error)
    return json({ status: 'ERROR', reason: 'could not create the invoice' }, 500)
  }

  const record: QuoteRecord = {
    quote: created.quote,
    pubkey,
    mintUrl,
    amountSats,
    invoice: created.invoice,
    state: 'INFLIGHT',
    createdAt: Math.floor(Date.now() / 1000),
    zapRequest
  }
  await writeQuote(env, record)

  return json({
    pr: created.invoice,
    routes: [],
    verify: `${url.origin}/lnurl/verify/${created.quote}`
  }, 200)
}

// LNURL verify (LUD-21): lets payer wallets show the payment as pending/paid.
export const handleLnurlVerify = async (request: Request, env: Env): Promise<Response> => {
  const quoteId = decodeURIComponent(new URL(request.url).pathname.split('/').pop() ?? '')
  const record = await readQuote(env, quoteId)
  if (!record) return json({ status: 'ERROR', reason: 'unknown quote' }, 404)

  try {
    const status = await getMintQuote(env, record.quote, record.mintUrl)
    record.state = status.state
    if (status.preimage) record.preimage = status.preimage
    await writeQuote(env, record)
  } catch (error) {
    console.warn('Unable to refresh the mint quote:', error)
  }

  const paid = record.state === 'PAID' || record.state === 'ISSUED'
  return json({
    status: 'OK',
    settled: paid,
    preimage: record.preimage,
    pr: record.invoice
  }, 200)
}

// -------------------------------------------------------------- API v2

export const handleApiV2 = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '')

  if (path === '/api/v2/info' && request.method === 'GET') {
    return json({
      version: 2,
      mint: getCashuMintUrl(env),
      features: { username: { enabled: false } }
    }, 200)
  }

  const auth = await authenticateNip98(request, request.method === 'PATCH' ? 'PATCH' : 'GET')
  if (auth instanceof Response) return auth
  const { pubkey } = auth

  if (path === '/api/v2/user') {
    if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405)
    return json({
      pubkey,
      npub: nip19.npubEncode(pubkey),
      mintUrl: (await readMintPreference(env, pubkey)) ?? getCashuMintUrl(env)
    }, 200)
  }

  if (path === '/api/v2/user/mint' && request.method === 'PATCH') {
    if (!env.BRIO_KV) return json({ error: 'coordinator is not configured' }, 503)
    let payload: { mint_url?: string }
    try {
      payload = await request.json() as { mint_url?: string }
    } catch {
      return json({ error: 'invalid body' }, 400)
    }
    const mintUrl = payload.mint_url?.trim()
    if (!mintUrl || !/^https:\/\//.test(mintUrl)) {
      return json({ error: 'invalid mint_url' }, 400)
    }
    await env.BRIO_KV.put(
      `${USER_KEY_PREFIX}${pubkey}`,
      JSON.stringify({ mintUrl }),
      { expirationTtl: 60 * 60 * 24 * 365 }
    )
    return json({ pubkey, mintUrl }, 200)
  }

  if (path === '/api/v2/wallet/quotes' && request.method === 'GET') {
    if (!env.BRIO_KV) return json({ error: 'coordinator is not configured' }, 503)
    const quoteIds = await listUserQuoteIds(env, pubkey)
    const quotes: WalletQuote[] = []
    for (const quoteId of quoteIds.slice(-50)) {
      const record = await readQuote(env, quoteId)
      if (!record) continue
      // Refresh unsettled quotes against the mint so claimers see fresh state.
      if (record.state === 'INFLIGHT') {
        try {
          const status = await getMintQuote(env, record.quote, record.mintUrl)
          record.state = status.state
          if (status.preimage) record.preimage = status.preimage
          await writeQuote(env, record)
        } catch (error) {
          console.warn(`Unable to refresh quote ${record.quote}:`, error)
        }
      }
      quotes.push({
        quote: record.quote,
        mintUrl: record.mintUrl,
        amountSats: record.amountSats,
        invoice: record.invoice,
        state: record.state,
        createdAt: record.createdAt,
        paidAt: record.paidAt,
        preimage: record.preimage,
        zap: Boolean(record.zapRequest)
      })
    }
    quotes.sort((a, b) => b.createdAt - a.createdAt)
    return json(quotes, 200)
  }

  return json({ error: 'not found' }, 404)
}

// ------------------------------------------------------------------- cron

// Unsettled states that the poller should keep refreshing against the mint.
const CLAIMABLE_STATES = new Set<QuoteState>(['INFLIGHT', 'UNPAID'])

// Polls unsettled quotes against the mint, flips them to PAID/ISSUED and
// publishes NIP-57 zap receipts once a payment settles. Runs from the cron
// handler; keeps per-run work bounded.
export const pollNpubcashQuotes = async (env: Env): Promise<void> => {
  if (!env.BRIO_KV) return
  const page = await env.BRIO_KV.list({ prefix: QUOTE_KEY_PREFIX })
  const now = Math.floor(Date.now() / 1000)

  for (const key of page.keys.slice(0, 40)) {
    const quoteId = key.name.slice(QUOTE_KEY_PREFIX.length)
    const record = await readQuote(env, quoteId)
    if (!record || !CLAIMABLE_STATES.has(record.state)) continue
    // Drop quotes nobody paid within 24h; mints expire them anyway.
    if (now - record.createdAt > 60 * 60 * 24) {
      await env.BRIO_KV.delete(`${QUOTE_KEY_PREFIX}${record.quote}`)
      await env.BRIO_KV.delete(`${INDEX_KEY_PREFIX}${record.pubkey}:${record.quote}`)
      continue
    }

    try {
      const status = await getMintQuote(env, record.quote, record.mintUrl)
      if (!status.paid) continue
      record.state = status.state
      if (status.preimage) record.preimage = status.preimage
      record.paidAt = now
      await writeQuote(env, record)

      if (record.zapRequest && !record.receiptPublished) {
        try {
          const validated = validateZapRequest(record.zapRequest, record.pubkey, record.amountSats * 1000)
          if (validated.ok) {
            await publishZapReceipt(env, record, validated.request)
            record.receiptPublished = true
            await writeQuote(env, record)
          }
        } catch (error) {
          console.warn('Unable to publish the zap receipt:', error)
        }
      }
    } catch (error) {
      console.warn(`Unable to refresh quote ${quoteId}:`, error)
    }
  }
}
