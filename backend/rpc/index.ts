import * as z from 'zod'
import type { Env } from '../env.js'
import { json } from '../http.js'
import { botInfoHandler } from './bot-service/bot-info.js'
import { notifyPaymentHandler } from './payment-service/notifyPayment.js'
import { verifyProfileHandler } from './user-service/verifyProfile.js'

const OperationSchema = z.object({
  operation: z.string(),
  payload: z.unknown().optional()
})

type Handler = (payload: unknown, env: Env) => Promise<Response>

const handlers: Record<string, Handler> = {
  'bot-info': botInfoHandler,
  'verify-profile': verifyProfileHandler,
  'notify-payment': notifyPaymentHandler
}

export const rpcHandler = async (request: Request, env: Env): Promise<Response> => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid JSON body' }, 400)
  }

  const parsed = OperationSchema.safeParse(body)
  if (!parsed.success) return json({ error: parsed.error }, 400)

  const handler = handlers[parsed.data.operation]
  if (!handler) return json({ error: `invalid operation: ${parsed.data.operation}` }, 400)

  try {
    return await handler(parsed.data.payload ?? {}, env)
  } catch (error) {
    console.error(`RPC operation ${parsed.data.operation} failed:`, error)
    return json({ error: 'internal server error' }, 500)
  }
}
