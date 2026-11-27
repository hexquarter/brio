import * as z from 'zod'
import type { Env } from '../../env.js'
import { json } from '../../http.js'
import { verifyTelegramUser } from '../telegram-auth.js'
import {
  getWebhookSecret,
  hmacToken,
  writeWalletRegistry,
  type WalletRegistry
} from '../../webhooks/common.js'

const RegisterSchema = z.object({
  tgInitData: z.string().min(1),
  nostrPublicKey: z.string().regex(/^[0-9a-f]{64}$/i),
  btcAddress: z.string().min(10).max(120).optional(),
  lightningAddress: z.string().min(3).max(120).optional()
})

export const registerWebhookHandler = async (payload: unknown, env: Env, request: Request) => {
  const parsed = RegisterSchema.safeParse(payload)
  if (!parsed.success) return json({ error: parsed.error }, 400)

  const input = parsed.data
  const telegramUser = await verifyTelegramUser(input.tgInitData, env)
  if (!telegramUser) return json({ error: 'invalid or expired Telegram init data' }, 401)

  const secret = await hmacToken(getWebhookSecret(env), input.nostrPublicKey)
  const origin = new URL(request.url).origin
  const webhookUrl = `${origin}/spark/webhook?pk=${input.nostrPublicKey}&k=${secret}`

  const registry: WalletRegistry = {
    secret,
    chatId: telegramUser.id,
    username: telegramUser.username,
    lightningAddress: input.lightningAddress,
    btcAddress: input.btcAddress,
    updatedAt: Math.floor(Date.now() / 1000)
  }

  await writeWalletRegistry(env, registry, input.nostrPublicKey)

  return json({ status: 'ok', webhookUrl, secret })
}
