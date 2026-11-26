import type { Env } from '../env.js'

export type WalletRegistry = {
  // Per-wallet secret required by the Spark webhook URL. Only the wallet and
  // this worker know it; the webhook handler rejects requests without it.
  secret: string
  chatId: string
  username?: string
  lightningAddress?: string
  // Watched Bitcoin address for L1 deposit notifications.
  btcAddress?: string
  // Latest transaction ids seen on the watched address (newest first).
  recentTxids?: string[]
  updatedAt: number
}

export const WALLET_KEY_PREFIX = 'wallet:'

const encoder = new TextEncoder()

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')

export const getWebhookSecret = (env: Env) => env.WEBHOOK_HMAC_SECRET || env.BOT_TOKEN

export const hmacToken = async (secret: string, message: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return bytesToHex(new Uint8Array(signature))
}

export const readWalletRegistry = async (env: Env, nostrPublicKey: string): Promise<WalletRegistry | null> => {
  if (!env.BRIO_KV) return null
  const raw = await env.BRIO_KV.get(`${WALLET_KEY_PREFIX}${nostrPublicKey}`)
  if (!raw) return null
  try {
    return JSON.parse(raw) as WalletRegistry
  } catch {
    return null
  }
}

export const writeWalletRegistry = async (env: Env, registry: WalletRegistry, nostrPublicKey: string) => {
  if (!env.BRIO_KV) return
  await env.BRIO_KV.put(
    `${WALLET_KEY_PREFIX}${nostrPublicKey}`,
    JSON.stringify(registry),
    { metadata: { chatId: registry.chatId, btcAddress: registry.btcAddress } }
  )
}

type UnknownRecord = Record<string, unknown>

// The Spark webhook payload shape is not part of the SDK typings. Accept both
// flat payloads and { event: {...} } envelopes, and the common amount field
// spellings, so unknown variations still produce a useful notification.
export type ParsedWebhookEvent = {
  type: string
  amountSats?: number
  paymentHash?: string
  txid?: string
}

const pick = (source: unknown, keys: string[]) => {
  if (!source || typeof source !== 'object') return undefined
  const record = source as UnknownRecord
  for (const key of keys) {
    const value = record[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

export const parseWebhookEvent = (body: unknown): ParsedWebhookEvent => {
  const event = pick(body, ['event', 'payload']) ?? body
  const type = String(pick(event, ['type']) ?? 'unknown')
  const amountMsat = Number(pick(event, ['amountMsat', 'amount_msat']) ?? 0)
  const amountSatsRaw = Number(pick(event, ['amountSats', 'amount_sats', 'amountSat', 'amount']) ?? 0)
  const amountSats = amountSatsRaw > 0 ? Math.floor(amountSatsRaw) : amountMsat > 0 ? Math.floor(amountMsat / 1000) : undefined
  const paymentHash = pick(event, ['paymentHash', 'payment_hash'])
  const txid = pick(event, ['txid', 'bitcoinTxid', 'bitcoin_txid', 'txId', 'tx_id'])
  return {
    type,
    amountSats: amountSats && Number.isFinite(amountSats) && amountSats > 0 ? amountSats : undefined,
    paymentHash: typeof paymentHash === 'string' ? paymentHash : undefined,
    txid: typeof txid === 'string' ? txid : undefined
  }
}

export const formatReceivedMessage = (event: ParsedWebhookEvent, address?: string) => {
  const amountLine = event.amountSats ? `Amount: ${event.amountSats.toLocaleString('en-US')} sats\n` : ''
  const isDeposit = event.type.includes('deposit') || event.type.includes('Deposit')
  const title = isDeposit
    ? '₿ On-chain Bitcoin deposit received'
    : event.type.includes('send')
      ? '⚡ Payment sent'
      : '⚡ Payment received'
  const detail = event.txid ? `\nTx: ${event.txid}` : event.paymentHash ? `\nPayment hash: ${event.paymentHash}` : ''
  return `${title}\n${amountLine}${address ? `Address: ${address}\n` : ''}${detail}`.trim()
}
