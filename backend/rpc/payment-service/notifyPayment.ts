import * as z from 'zod'
import type { Env } from '../../env.js'
import { json } from '../../http.js'
import { getBotInfo, sendTelegramMessage } from '../../bot/index.js'
import { verifyTelegramUser } from '../telegram-auth.js'
import {
  findAttestationByContact,
  findAttestationByPubkey,
  getPaymentEvent,
  getPaymentRecipient,
  readAttestation,
  readPayment
} from '../nostr.js'

const NotifySchema = z.object({
  paymentEventId: z.string().regex(/^[0-9a-f]{64}$/i),
  tgInitData: z.string().min(1)
})

export const notifyPaymentHandler = async (payload: unknown, env: Env) => {
  const parsed = NotifySchema.safeParse(payload)
  if (!parsed.success) return json({ error: parsed.error }, 400)

  const telegramUser = await verifyTelegramUser(parsed.data.tgInitData, env)
  if (!telegramUser) return json({ error: 'invalid or expired Telegram init data' }, 401)

  try {
    const paymentEvent = await getPaymentEvent(env, parsed.data.paymentEventId)
    if (!paymentEvent) return json({ error: 'payment event not found' }, 404)

    const senderAttestation = await findAttestationByPubkey(env, paymentEvent.pubkey)
    if (!senderAttestation) {
      return json({ error: 'payment sender is not verified' }, 403)
    }
    const sender = readAttestation(env, senderAttestation)
    if (sender.chatId !== telegramUser.id) {
      return json({ error: 'payment does not belong to this Telegram user' }, 403)
    }

    const recipient = getPaymentRecipient(paymentEvent)
    const recipientAttestation = recipient.publicKey
      ? await findAttestationByPubkey(env, recipient.publicKey)
      : recipient.contact
        ? await findAttestationByContact(env, recipient.contact)
        : null
    if (!recipientAttestation) {
      return json({ error: 'payment recipient is not verified' }, 404)
    }

    const recipientClient = readAttestation(env, recipientAttestation)
    const payment = readPayment(env, paymentEvent)
    const bot = await getBotInfo(env)
    const paymentReference = payment.paymentHash ?? payment.paymentId
    const startParam = encodeURIComponent(new URLSearchParams({ payment: paymentReference }).toString())
    const miniAppUrl = `https://t.me/${bot.username}?startapp=${startParam}`

    await sendTelegramMessage(
      env,
      recipientClient.chatId,
      '⚡ You just received a payment',
      { inline_keyboard: [[{ text: 'Check it out', url: miniAppUrl }]] }
    )

    return json({ status: 'ok' })
  } catch (error) {
    console.error('Telegram payment notification failed:', error)
    return json({ error: 'unable to notify Telegram recipient' }, 503)
  }
}
