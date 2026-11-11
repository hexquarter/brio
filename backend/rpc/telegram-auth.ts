import type { Env } from '../env.js'
import { verifyTelegramAuth } from './utils.js'

export type VerifiedTelegramUser = {
  id: string
  username?: string
}

export const verifyTelegramUser = async (
  initData: string,
  env: Env
): Promise<VerifiedTelegramUser | null> => {
  const params = new URLSearchParams(initData)
  const userJson = params.get('user')
  if (!userJson) return null

  const nowSeconds = Math.floor(Date.now() / 1000)
  const authDate = Number(params.get('auth_date'))
  const allowDev = env.ENVIRONMENT === 'development'
    && env.ALLOW_UNVERIFIED_TELEGRAM_DEV === 'true'

  if (!allowDev) {
    if (!env.BOT_TOKEN) {
      console.error('BOT_TOKEN is not configured; set it in backend/.dev.vars or the Worker environment.')
      return null
    }
    if (!Number.isFinite(authDate) || authDate > nowSeconds + 300 || nowSeconds - authDate > 86400) {
      return null
    }
    if (!await verifyTelegramAuth(initData, env.BOT_TOKEN)) return null
  }

  try {
    const user = JSON.parse(userJson) as { id?: number | string; username?: string }
    if (user.id === undefined || !/^\d+$/.test(String(user.id))) return null
    return {
      id: String(user.id),
      username: user.username
    }
  } catch {
    return null
  }
}
