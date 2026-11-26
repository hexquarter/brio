import { nip19 } from 'nostr-tools'
import type { Env } from './env.js'
import { json } from './http.js'
import {
  findAttestationByContact,
  findAttestationByPubkey,
  hashContact,
  queryEvents,
  readAttestation
} from './rpc/nostr.js'

/**
 * Public resolver for the Telegram <-> Nostr gateway. Both rails of a Brio
 * wallet are already published (kind 0 profiles on relays, verified by the
 * service attestations), so resolution is a relay query + attestation check:
 *
 *   /resolve/npub/<npub|hex>     -> payment info + Telegram identity
 *   /resolve/telegram/<handle>   -> payment info + Nostr identity
 */

const TELEGRAM_HANDLE_PATTERN = /^[a-z0-9_]{4,64}$/
const HEX_PUBKEY_PATTERN = /^[0-9a-f]{64}$/

type ProfileFields = {
  name?: string
  lud16?: string
  lightningAddress?: string
  lnurl?: string
  btcAddress?: string
  nip05?: string
  website?: string
}

type ResolveResult = {
  publicKey: string
  npub: string
  telegramUsername?: string
  lightningAddress?: string
  lnurl?: string
  btcAddress?: string
  nip05?: string
  website?: string
  deepLink?: string
  name?: string
  verified: boolean
  updatedAt?: number
}

const readProfile = async (env: Env, publicKey: string): Promise<ProfileFields | null> => {
  const events = await queryEvents(env, { kinds: [0], authors: [publicKey], limit: 1 })
  const profile = events.sort((a, b) => b.created_at - a.created_at)[0]
  if (!profile) return null
  try {
    return JSON.parse(profile.content) as ProfileFields
  } catch {
    return null
  }
}

const respond = (env: Env, publicKey: string, profile: ProfileFields | null, extra: {
  verified: boolean
  telegramUsername?: string
  updatedAt?: number
}) => {
  const encoded = nip19.npubEncode(publicKey)
  const botUsername = env.BOT_USERNAME?.trim()
  const result: ResolveResult = {
    publicKey,
    npub: encoded,
    name: profile?.name,
    telegramUsername: extra.telegramUsername,
    lightningAddress: profile?.lightningAddress ?? profile?.lud16,
    lnurl: profile?.lnurl,
    btcAddress: profile?.btcAddress,
    nip05: profile?.nip05,
    website: profile?.website,
    // Opens the Telegram Mini App with this npub prefilled as a recipient,
    // so Nostr clients can hand a payment over to Telegram.
    deepLink: botUsername ? `https://t.me/${botUsername}/app?startapp=${encoded}` : undefined,
    verified: extra.verified,
    updatedAt: extra.updatedAt
  }
  return json(result, 200, { 'Cache-Control': 'public, max-age=60' })
}

export const resolveNpub = async (env: Env, input: string): Promise<Response> => {
  const value = input.trim().toLowerCase()
  let publicKey: string | null = null
  if (HEX_PUBKEY_PATTERN.test(value)) {
    publicKey = value
  } else {
    try {
      const decoded = nip19.decode(value)
      if (decoded.type === 'npub') publicKey = decoded.data as string
      if (decoded.type === 'nprofile') publicKey = (decoded.data as { pubkey: string }).pubkey
    } catch {
      return json({ error: 'invalid npub' }, 400)
    }
  }
  if (!publicKey) return json({ error: 'invalid npub' }, 400)

  const profile = await readProfile(env, publicKey)
  if (!profile) return json({ error: 'no profile found' }, 404)

  let verified = false
  let telegramUsername: string | undefined
  let updatedAt: number | undefined
  try {
    const attestation = await findAttestationByPubkey(env, publicKey)
    if (attestation) {
      const client = readAttestation(env, attestation)
      telegramUsername = client.username ?? undefined
      updatedAt = client.verifiedAt
      verified = true
    }
  } catch (error) {
    console.warn('Unable to read the attestation:', error)
  }

  return respond(env, publicKey, profile, { verified, telegramUsername, updatedAt })
}

export const resolveTelegram = async (env: Env, input: string): Promise<Response> => {
  const handle = input.trim().toLowerCase().replace(/^@/, '')
  if (!TELEGRAM_HANDLE_PATTERN.test(handle)) {
    return json({ error: 'invalid telegram handle' }, 400)
  }

  let publicKey: string | null = null
  let updatedAt: number | undefined

  // Preferred: the service attestation tagged with the (hashed) contact.
  try {
    const contactHash = await hashContact(handle)
    const attestation = await findAttestationByContact(env, contactHash)
    if (attestation) {
      const client = readAttestation(env, attestation)
      publicKey = client.nostrPublicKey
      updatedAt = client.verifiedAt
    }
  } catch (error) {
    console.warn('Unable to resolve the contact attestation:', error)
  }

  // Fallback: the NIP-05 directory written during profile verification.
  if (!publicKey && env.BRIO_KV) {
    const raw = await env.BRIO_KV.get(`nip05:${handle}`)
    if (raw) {
      try {
        publicKey = (JSON.parse(raw) as { pubkey: string }).pubkey
      } catch {
        publicKey = null
      }
    }
  }

  if (!publicKey || !HEX_PUBKEY_PATTERN.test(publicKey)) {
    return json({ error: 'no verified wallet for this handle' }, 404)
  }

  const profile = await readProfile(env, publicKey)
  if (!profile) return json({ error: 'no profile found' }, 404)

  return respond(env, publicKey, profile, { verified: true, telegramUsername: handle, updatedAt })
}

export const handleResolve = async (request: Request, env: Env): Promise<Response> => {
  const match = new URL(request.url).pathname.match(/^\/resolve\/(npub|telegram)\/(.+)$/)
  if (!match) return json({ error: 'not found' }, 404)
  const [, kind, value] = match
  try {
    if (kind === 'npub') return await resolveNpub(env, decodeURIComponent(value))
    return await resolveTelegram(env, decodeURIComponent(value))
  } catch (error) {
    console.error('Resolve failed:', error)
    return json({ error: 'resolution failed' }, 500)
  }
}
