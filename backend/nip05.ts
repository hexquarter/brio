import type { Env } from './env.js'
import { json } from './http.js'

const NAME_PATTERN = /^[a-z0-9._-]+$/

// NIP-05: resolves <name>@<worker-domain> to the verified wallet's Nostr key.
// Entries are written by the verify-profile RPC after a successful Telegram
// verification, so other Nostr clients can badge and zap Brio users.
export const NIP05_KEY_PREFIX = 'nip05:'

export const storeNip05Entry = async (
  env: Env,
  name: string,
  nostrPublicKey: string,
  relays?: string[]
) => {
  if (!env.BRIO_KV || !NAME_PATTERN.test(name)) return
  await env.BRIO_KV.put(
    `${NIP05_KEY_PREFIX}${name}`,
    JSON.stringify({ pubkey: nostrPublicKey, relays }),
    { expirationTtl: 60 * 60 * 24 * 60 }
  )
}

export const handleNip05 = async (request: Request, env: Env): Promise<Response> => {
  if (!env.BRIO_KV) {
    return json({ error: 'NIP-05 directory is not configured' }, 503)
  }

  const name = (new URL(request.url).searchParams.get('name') ?? '').trim().toLowerCase()
  if (!name) {
    return json({ names: {}, relays: {} }, 200, { 'Cache-Control': 'no-cache' })
  }
  if (!NAME_PATTERN.test(name)) {
    return json({ error: 'invalid name' }, 400)
  }

  const raw = await env.BRIO_KV.get(`${NIP05_KEY_PREFIX}${name}`)
  if (!raw) {
    return json({ error: 'not found' }, 404, { 'Cache-Control': 'no-cache' })
  }

  const entry = JSON.parse(raw) as { pubkey: string; relays?: string[] }
  return json({
    names: { [name]: entry.pubkey },
    ...(entry.relays?.length ? { relays: { [entry.pubkey]: entry.relays } } : {})
  }, 200, { 'Cache-Control': 'no-cache' })
}
