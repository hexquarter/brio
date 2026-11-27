import type { Env } from '../env.js'
import { json } from '../http.js'
import { getBotInfo, sendTelegramMessage } from '../bot/index.js'
import { findAttestationByPubkey, readAttestation } from '../rpc/nostr.js'
import {
  formatReceivedMessage,
  getWebhookSecret,
  hmacToken,
  parseWebhookEvent,
  readWalletRegistry,
  safeEqualHex,
  type WalletRegistry
} from './common.js'

const PUBLIC_KEY_PATTERN = /^[0-9a-f]{64}$/i

// Resolves the chat to notify. The KV registry is the fast path; the Nostr
// attestation is the fallback so notifications keep working without KV.
const resolveWallet = async (
  env: Env,
  nostrPublicKey: string,
  token: string
): Promise<{ chatId: string; registry: WalletRegistry | null } | null> => {
  const registry = await readWalletRegistry(env, nostrPublicKey)
  if (registry) {
    if (registry.secret !== token) return null
    return { chatId: registry.chatId, registry }
  }

  // Without KV the token must match the derived HMAC and the chat id comes
  // from the verification attestation published on the relays.
  if (token !== await hmacToken(getWebhookSecret(env), nostrPublicKey)) return null
  const attestation = await findAttestationByPubkey(env, nostrPublicKey)
  if (!attestation) return null
  return { chatId: readAttestation(env, attestation).chatId, registry: null }
}

const isFailure = (status?: string) =>
  status === 'FAILED' || status === 'CANCELED' || /FAILED|CANCELED/.test(status ?? '')

export const handleSparkWebhook = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url)
  const nostrPublicKey = url.searchParams.get('pk') ?? ''
  const token = url.searchParams.get('k') ?? ''
  if (!PUBLIC_KEY_PATTERN.test(nostrPublicKey) || !token) {
    return json({ error: 'bad request' }, 400)
  }

  const wallet = await resolveWallet(env, nostrPublicKey, token)
  if (!wallet) return json({ error: 'forbidden' }, 403)

  const rawBody = await request.text()
  // Spark signs the raw body with the secret returned by the register RPC.
  // Deliveries without the header still authenticate via the URL token.
  const signature = request.headers.get('X-Spark-Signature')?.replace(/^sha256=/i, '')
  if (signature && !safeEqualHex(await hmacToken(token, rawBody), signature)) {
    return json({ error: 'bad signature' }, 403)
  }

  let body: unknown = null
  try {
    body = JSON.parse(rawBody)
  } catch {
    // An unparseable body has no event data; acknowledge so Spark stops retrying.
  }
  console.log(`Spark webhook event for ${nostrPublicKey.slice(0, 8)}…:`, rawBody)

  const event = parseWebhookEvent(body)
  if (isFailure(event.requestStatus) || isFailure(event.status)) {
    console.log(`Ignoring unsuccessful Spark event: ${event.type} ${event.status ?? ''}`)
    return json({ status: 'ignored' })
  }

  try {
    const bot = await getBotInfo(env)
    const miniAppUrl = `https://t.me/${bot.username}?startapp=wallet`
    const message = formatReceivedMessage(
      event,
      wallet.registry?.btcAddress ?? wallet.registry?.lightningAddress
    )
    await sendTelegramMessage(env, wallet.chatId, message, {
      inline_keyboard: [[{ text: 'Open Brio', url: miniAppUrl }]]
    })
  } catch (error) {
    // Never make Breez retry because of a Telegram hiccup.
    console.error('Telegram notification failed for Spark webhook:', error)
  }

  return json({ status: 'ok' })
}
