import type { Env } from './env.js'
import { json } from './http.js'
import { getServicePublicKey, publishEvent } from './rpc/nostr.js'

const BADGE_ID = 'brio-verified'
const BADGE_NAME = 'Verified Brio User'
const BADGE_DESCRIPTION = 'This Nostr account belongs to a verified Brio Bitcoin wallet user.'
const AWARD_FLAG_TTL_SECONDS = 60 * 60 * 24 * 30

export const badgeIdentifier = (env: Env) => `30009:${getServicePublicKey(env)}:${BADGE_ID}`

export const badgeDefinitionUrl = (origin: string) => `${origin}/badge/${BADGE_ID}.svg`

/**
 * NIP-58 badge: the service publishes the badge definition (kind 30009) and
 * awards it (kind 8) to every verified user. Users opt in by accepting the
 * badge with a kind 30008 event published from their own key, which Nostr
 * clients (e.g. Amethyst, Primal) render as a profile badge.
 */
export const publishUserBadge = async (
  env: Env,
  origin: string,
  input: { nostrPublicKey: string; profileEventId: string }
) => {
  const now = Math.floor(Date.now() / 1000)

  // Re-publish the definition occasionally so new relays pick it up. KV
  // limits this to once a day per service key.
  if (!env.BRIO_KV || !(await env.BRIO_KV.get('badge:definition:published'))) {
    await publishEvent(env, {
      kind: 30009,
      created_at: now,
      tags: [
        ['d', BADGE_ID],
        ['name', BADGE_NAME],
        ['description', BADGE_DESCRIPTION],
        ['image', badgeDefinitionUrl(origin)],
        ['t', 'brio-badge']
      ],
      content: ''
    })
    if (env.BRIO_KV) {
      await env.BRIO_KV.put('badge:definition:published', '1', {
        expirationTtl: 60 * 60 * 24
      })
    }
  }

  // Avoid duplicate award events for the same user.
  const awardFlag = env.BRIO_KV ? await env.BRIO_KV.get(`badge:award:${input.nostrPublicKey}`) : null
  if (!awardFlag) {
    await publishEvent(env, {
      kind: 8,
      created_at: now,
      tags: [
        ['a', badgeIdentifier(env)],
        ['p', input.nostrPublicKey],
        ['e', input.profileEventId],
        ['k', '30009']
      ],
      content: BADGE_NAME
    })
    if (env.BRIO_KV) {
      await env.BRIO_KV.put(`badge:award:${input.nostrPublicKey}`, '1', {
        expirationTtl: AWARD_FLAG_TTL_SECONDS
      })
    }
  }
}

// Simple self-contained badge image served by the worker so NIP-58
// definitions have a stable visual.
export const badgeSvgResponse = (): Response => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FF942C"/>
      <stop offset="1" stop-color="#F97316"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#g)"/>
  <path d="M296 64 160 292h84l-28 156 136-228h-84l28-156z" fill="#fff"/>
  <text x="256" y="470" font-family="Helvetica,Arial,sans-serif" font-size="40" font-weight="bold" fill="#fff" text-anchor="middle">VERIFIED BRIO USER</text>
</svg>`
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400'
    }
  })
}

// Small helper used by the routes to keep JSON badge metadata in one place.
export const badgeInfoResponse = (env: Env) =>
  json({
    id: BADGE_ID,
    identifier: badgeIdentifier(env),
    name: BADGE_NAME,
    description: BADGE_DESCRIPTION
  })
