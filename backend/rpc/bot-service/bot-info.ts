import type { Env } from '../../env.js'
import { json } from '../../http.js'
import { getBotInfo } from '../../bot/index.js'

export const botInfoHandler = async (_payload: unknown, env: Env) => {
  try {
    return json(await getBotInfo(env))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Fetch bot info error:', message)
    return json({ error: message }, 500)
  }
}
