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

const MEMPOOL_API = 'https://mempool.space/api'

// Snapshots the latest transactions on the watched address so the L1 cron
// only reports deposits that arrive after registration.
const snapshotRecentTxids = async (btcAddress: string): Promise<string[]> => {
  try {
    const response = await fetch(`${MEMPOOL_API}/address/${btcAddress}/txs`)
    if (!response.ok) return []
    const txs = await response.json() as Array<{ txid?: string }>
    return txs.map(tx => tx.txid).filter((id): id is string => !!id).slice(0, 25)
  } catch (error) {
    console.warn('Unable to snapshot Bitcoin address transactions:', error)
    return []
  }
}

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

  // Seed the L1 watch with the current transaction list so only future
  // deposits trigger notifications.
  if (input.btcAddress) {
    registry.recentTxids = await snapshotRecentTxids(input.btcAddress)
  }
  await writeWalletRegistry(env, registry, input.nostrPublicKey)

  return json({ status: 'ok', webhookUrl, secret })
}
