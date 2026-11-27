import type { Env } from '../env.js'

export type WalletRegistry = {
  // Per-wallet secret required by the Spark webhook URL. Only the wallet and
  // this worker know it; the webhook handler rejects requests without it.
  secret: string
  chatId: string
  username?: string
  lightningAddress?: string
  // Bitcoin address shown in payment notifications.
  btcAddress?: string
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

// Spark webhook payloads are flat JSON objects (also accept an `event` or
// `payload` envelope). Amounts are `{ value, unit }` objects — SATOSHI or
// MILLISATOSHI — rather than plain numbers.
export type ParsedWebhookEvent = {
  type: string
  status?: string
  requestStatus?: string
  amountSats?: number
  paymentHash?: string
  txid?: string
  address?: string
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

const toSats = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
  }
  if (value && typeof value === 'object') {
    const record = value as UnknownRecord
    const raw = Number(record.value)
    if (!Number.isFinite(raw) || raw <= 0) return undefined
    const unit = String(record.unit ?? 'SATOSHI').toUpperCase()
    return Math.floor(unit === 'MILLISATOSHI' ? raw / 1000 : raw)
  }
  return undefined
}

const pickAmount = (event: unknown, keys: string[]) => {
  for (const key of keys) {
    const sats = toSats(pick(event, [key]))
    if (sats) return sats
  }
  return undefined
}

export const parseWebhookEvent = (body: unknown): ParsedWebhookEvent => {
  const event = pick(body, ['event', 'payload']) ?? body
  const status = pick(event, ['status'])
  const requestStatus = pick(event, ['request_status'])
  const paymentHash = pick(event, ['paymentHash', 'payment_hash'])
  const txid = pick(event, ['transaction_id', 'coop_exit_txid', 'txid', 'bitcoinTxid', 'bitcoin_txid', 'txId', 'tx_id'])
  const address = pick(event, ['static_deposit_address', 'withdrawal_address', 'address'])
  return {
    type: String(pick(event, ['type']) ?? 'unknown'),
    status: typeof status === 'string' ? status : undefined,
    requestStatus: typeof requestStatus === 'string' ? requestStatus : undefined,
    // For static deposits, credit_amount is what actually reached the wallet.
    amountSats: pickAmount(event, [
      'credit_amount', 'deposit_amount', 'htlc_amount', 'invoice_amount',
      'total_amount', 'amountSats', 'amount_sats', 'amountSat', 'amount'
    ]),
    paymentHash: typeof paymentHash === 'string' ? paymentHash : undefined,
    txid: typeof txid === 'string' ? txid : undefined,
    address: typeof address === 'string' ? address : undefined
  }
}

// Spark signs the raw body with the per-wallet secret via X-Spark-Signature.
export const safeEqualHex = (expected: string, actual: string): boolean => {
  const a = expected.toLowerCase()
  const b = actual.toLowerCase()
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export const formatReceivedMessage = (event: ParsedWebhookEvent, address?: string) => {
  const amountLine = event.amountSats ? `Amount: ${event.amountSats.toLocaleString('en-US')} sats\n` : ''
  const type = event.type.toUpperCase()
  const title = type.includes('STATIC_DEPOSIT')
    ? '₿ On-chain Bitcoin deposit received'
    : type.includes('COOP_EXIT')
      ? '₿ Cooperative exit completed'
      : type.includes('LIGHTNING_SEND')
        ? '⚡ Payment sent'
        : '⚡ Payment received'
  const detail = event.txid ? `\nTx: ${event.txid}` : event.paymentHash ? `\nPayment hash: ${event.paymentHash}` : ''
  const displayAddress = event.address ?? address
  return `${title}\n${amountLine}${displayAddress ? `Address: ${displayAddress}\n` : ''}${detail}`.trim()
}
