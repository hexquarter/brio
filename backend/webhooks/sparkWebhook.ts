import type { Env } from '../env.js'
import { json } from '../http.js'
import { getBotInfo, sendTelegramMessage } from '../bot/index.js'
import { findAttestationByPubkey, readAttestation } from '../rpc/nostr.js'
import {
  formatReceivedMessage,
  getWebhookSecret,
  hmacToken,
  parseWebhookEvent,
  readWalletRegistry
} from './common.js'

const PUBLIC_KEY_PATTERN = /^[0-9a-f]{64}$/i

// Resolves the chat to notify. The KV registry is the fast path; the Nostr
// attestation is the fallback so Lightning notifications keep working even
// when the KV namespace is not configured.
const resolveChatId = async (env: Env, nostrPublicKey: string, token: string) => {
  const registry = await readWalletRegistry(env, nostrPublicKey)
  if (registry) {
    if (registry.secret !== token) return null
    return registry.chatId
  }

  // Without KV the token must match the derived HMAC and the chat id comes
  // from the verification attestation published on the relays.
  if (token !== await hmacToken(getWebhookSecret(env), nostrPublicKey)) return null
  const attestation = await findAttestationByPubkey(env, nostrPublicKey)
  if (!attestation) return null
  return readAttestation(env, attestation).chatId
}

export const handleSparkWebhook = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url)
  const nostrPublicKey = url.searchParams.get('pk') ?? ''
  const token = url.searchParams.get('k') ?? ''
  if (!PUBLIC_KEY_PATTERN.test(nostrPublicKey) || !token) {
    return json({ error: 'bad request' }, 400)
  }

  const chatId = await resolveChatId(env, nostrPublicKey, token)
  if (!chatId) return json({ error: 'forbidden' }, 403)

  const body = await request.json().catch(() => null)
  console.log(`Spark webhook event for ${nostrPublicKey.slice(0, 8)}…:`, JSON.stringify(body))

  const event = parseWebhookEvent(body)
  const registry = await readWalletRegistry(env, nostrPublicKey)

  try {
    const bot = await getBotInfo(env)
    const miniAppUrl = `https://t.me/${bot.username}?startapp=wallet`
    const message = formatReceivedMessage(event, registry?.btcAddress ?? registry?.lightningAddress)
    await sendTelegramMessage(env, chatId, message, {
      inline_keyboard: [[{ text: 'Open Brio', url: miniAppUrl }]]
    })
  } catch (error) {
    // Never make Breez retry because of a Telegram hiccup.
    console.error('Telegram notification failed for Spark webhook:', error)
  }

  return json({ status: 'ok' })
}
