import type { Env } from '../env.js'
import { getBotInfo, sendTelegramMessage } from './index.js'

type TelegramUpdate = {
  message?: {
    chat?: { id?: number | string }
    text?: string
  }
}

export const handleTelegramWebhook = async (request: Request, env: Env): Promise<Response> => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  if (env.TELEGRAM_WEBHOOK_SECRET) {
    const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token')
    if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response('Unauthorized', { status: 401 })
    }
  }

  const update = await request.json() as TelegramUpdate
  const message = update.message
  const text = message?.text ?? ''
  if (message?.chat?.id && (text.startsWith('/start') || text.startsWith('/open'))) {
    const bot = await getBotInfo(env)
    const link = `https://t.me/${bot.username}?startapp=wallet`
    await sendTelegramMessage(
      env,
      message.chat.id,
      'Open the Brio Bitcoin wallet to send and receive Bitcoin.',
      { inline_keyboard: [[{ text: 'Open Brio Wallet', url: link }]] }
    )
  }

  return new Response('ok')
}
