import * as z from 'zod'
import type { Env } from '../../env.js'
import { json } from '../../http.js'
import { verifyTelegramUser } from '../telegram-auth.js'
import { publishUserBadge } from '../../badge.js'
import { storeNip05Entry } from '../../nip05.js'
import {
  getEventById,
  getRelays,
  getServicePublicKey,
  hashContact,
  publishAttestation
} from '../nostr.js'

const VerifyProfileSchema = z.object({
  nostrPublicKey: z.string().regex(/^[0-9a-f]{64}$/i),
  profileEventId: z.string().regex(/^[0-9a-f]{64}$/i),
  tgInitData: z.string().min(1)
})

export const verifyProfileHandler = async (payload: unknown, env: Env, httpRequest: Request) => {
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

    // Best-effort extras: the NIP-05 directory entry and the NIP-58 badge
    // must never block the verification itself.
    if (telegramUser.username) {
      try {
        await storeNip05Entry(
          env,
          telegramUser.username.toLowerCase(),
          request.nostrPublicKey,
          getRelays(env)
        )
      } catch (error) {
        console.warn('Unable to store the NIP-05 entry:', error)
      }
    }
    try {
      await publishUserBadge(env, new URL(httpRequest.url).origin, {
        nostrPublicKey: request.nostrPublicKey,
        profileEventId: profileEvent.id
      })
    } catch (error) {
      console.warn('Unable to publish the user badge:', error)
    }

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
