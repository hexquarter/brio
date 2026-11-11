import type { Env } from '../env.js'

type ReplyMarkup = {
  inline_keyboard: Array<Array<{ text: string; url: string }>>
}

export const getBotToken = (env: Env) => {
  if (!env.BOT_TOKEN) throw new Error('BOT_TOKEN is not configured.')
  return env.BOT_TOKEN
}

export const getBotId = (env: Env) => getBotToken(env).split(':')[0]

const telegramApi = (env: Env, method: string) =>
  `https://api.telegram.org/bot${getBotToken(env)}/${method}`

export type BotInfo = {
  id: number
  is_bot: boolean
  first_name: string
  username: string
}

export const getBotInfo = async (env: Env): Promise<BotInfo> => {
  if (env.BOT_USERNAME) {
    return {
      id: Number(getBotId(env)),
      is_bot: true,
      first_name: env.BOT_USERNAME,
      username: env.BOT_USERNAME
    }
  }

  const response = await fetch(telegramApi(env, 'getMe'))
  const body = await response.json() as { ok: boolean; result?: BotInfo; description?: string }
  if (!response.ok || !body.ok || !body.result) {
    throw new Error(body.description ?? 'Unable to fetch Telegram bot info.')
  }
  return body.result
}

export const sendTelegramMessage = async (
  env: Env,
  chatId: string | number,
  text: string,
  replyMarkup?: ReplyMarkup
) => {
  const response = await fetch(telegramApi(env, 'sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {})
    })
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Telegram sendMessage failed: ${body}`)
  }
}
