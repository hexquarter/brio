import type { Env } from './env.js'
import { CORS_HEADERS, json, withCors } from './http.js'
import { rpcHandler } from './rpc/index.js'
import { getRelays, getServicePublicKey } from './rpc/nostr.js'
import { handleTelegramWebhook } from './bot/webhook.js'

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

      return json({ error: 'not found' }, 404, CORS_HEADERS)
    } catch (error) {
      console.error('Worker request failed:', error)
      return json({ error: 'internal server error' }, 500, CORS_HEADERS)
    }
  }
} satisfies ExportedHandler<Env>
