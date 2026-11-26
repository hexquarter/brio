import type { Env } from './env.js'
import { CORS_HEADERS, json, withCors } from './http.js'
import { rpcHandler } from './rpc/index.js'
import { getRelays, getServicePublicKey } from './rpc/nostr.js'
import { handleTelegramWebhook } from './bot/webhook.js'
import { handleSparkWebhook } from './webhooks/sparkWebhook.js'
import { handleScheduled } from './webhooks/l1Cron.js'
import { handleNip05 } from './nip05.js'
import { badgeInfoResponse, badgeSvgResponse } from './badge.js'

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    const url = new URL(request.url)

    try {
      if (request.method === 'GET' && url.pathname === '/') {
        return json({ status: 'ok' }, 200, CORS_HEADERS)
      }

      if (request.method === 'GET' && url.pathname === '/config') {
        return json({
          servicePublicKey: getServicePublicKey(env),
          relays: getRelays(env)
        }, 200, CORS_HEADERS)
      }

      if (request.method === 'POST' && url.pathname === '/rpc') {
        return withCors(await rpcHandler(request, env))
      }

      if (request.method === 'POST' && url.pathname === '/telegram/webhook') {
        return await handleTelegramWebhook(request, env)
      }

      // Spark SDK offline-payment webhooks (Lightning receives, static
      // deposits). Authenticated by the per-wallet token in the URL.
      if (request.method === 'POST' && url.pathname === '/spark/webhook') {
        return await handleSparkWebhook(request, env)
      }

      // NIP-05: <telegram-username>@<worker-domain> -> Nostr pubkey.
      if (request.method === 'GET' && url.pathname === '/.well-known/nostr.json') {
        return withCors(await handleNip05(request, env))
      }

      // NIP-58 badge assets.
      if (request.method === 'GET' && url.pathname === '/badge/brio-verified.svg') {
        return badgeSvgResponse()
      }
      if (request.method === 'GET' && url.pathname === '/badge/brio-verified.json') {
        return badgeInfoResponse(env)
      }

      return json({ error: 'not found' }, 404, CORS_HEADERS)
    } catch (error) {
      console.error('Worker request failed:', error)
      return json({ error: 'internal server error' }, 500, CORS_HEADERS)
    }
  },

  // L1 deposit notifications: poll watched Bitcoin addresses via
  // mempool.space and DM the wallet owner on Telegram.
  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      await handleScheduled(env)
    } catch (error) {
      console.error('Scheduled L1 poll failed:', error)
    }
  }
} satisfies ExportedHandler<Env>
