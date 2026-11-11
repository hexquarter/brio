import * as z from 'zod'
import type { Env } from '../../env.js'
import { json } from '../../http.js'
import { verifyTelegramUser } from '../telegram-auth.js'
import {
  getEventById,
  getServicePublicKey,
  hashContact,
  publishAttestation
} from '../nostr.js'

const VerifyProfileSchema = z.object({
  nostrPublicKey: z.string().regex(/^[0-9a-f]{64}$/i),
  profileEventId: z.string().regex(/^[0-9a-f]{64}$/i),
  tgInitData: z.string().min(1)
})

export const verifyProfileHandler = async (payload: unknown, env: Env) => {
  const parsed = VerifyProfileSchema.safeParse(payload)
  if (!parsed.success) return json({ error: parsed.error }, 400)

  const request = parsed.data
  const telegramUser = await verifyTelegramUser(request.tgInitData, env)
  if (!telegramUser) return json({ error: 'invalid or expired Telegram init data' }, 401)

  const profileEvent = await getEventById(env, request.profileEventId)
  if (!profileEvent || profileEvent.kind !== 0) {
    return json({ error: 'profile event not found' }, 404)
  }
  if (profileEvent.pubkey !== request.nostrPublicKey) {
    return json({ error: 'profile event does not belong to the supplied Nostr key' }, 400)
  }

  const contacts = telegramUser.username
    ? [await hashContact(telegramUser.username.toLowerCase())]
    : []
  if (!contacts.length) {
    return json({ error: 'a Telegram username is required for lookup' }, 400)
  }

  const profileHasContact = profileEvent.tags.some(
    ([name, value]) => name === 'contact' && contacts.includes(value)
  )
  if (!profileHasContact) {
    return json({ error: 'profile event does not include the verified contact' }, 400)
  }

  try {
    const attestation = await publishAttestation(env, {
      chatId: telegramUser.id,
      username: telegramUser.username,
      nostrPublicKey: request.nostrPublicKey,
      profileEventId: profileEvent.id,
      contacts
    })
    return json({
      status: 'ok',
      attestationId: attestation.id,
      servicePublicKey: getServicePublicKey(env)
    })
  } catch (error) {
    console.error('Publish attestation failed:', error)
    return json({ error: 'unable to publish Telegram verification' }, 503)
  }
}
