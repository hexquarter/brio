import { ed25519 } from '@noble/curves/ed25519.js'

const TELEGRAM_PUBLIC_KEY = 'e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d'

const encoder = new TextEncoder()

const base64UrlToBytes = (input: string) => {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

const hexToBytes = (input: string) =>
  Uint8Array.from(input.match(/.{2}/g) ?? [], byte => parseInt(byte, 16))

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')

const hmacSha256 = async (key: Uint8Array | string, data: Uint8Array | string) => {
  const keyBytes = typeof key === 'string' ? encoder.encode(key) : key
  const dataBytes = typeof data === 'string' ? encoder.encode(data) : data
  if (!keyBytes?.length || !dataBytes?.length) {
    throw new Error('hmacSha256 requires a non-empty key and data.')
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes)
  return new Uint8Array(signature)
}

const dataCheckString = (params: URLSearchParams) => {
  const fields = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
  return fields.map(([key, value]) => `${key}=${value}`).join('\n')
}

export const verifyTelegramAuth = async (initData: string, botToken: string) => {
  if (!initData || !botToken) return false

  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  const signature = params.get('signature')
  if (!hash && !signature) return false

  params.delete('hash')
  params.delete('signature')
  const checkString = dataCheckString(params)

  if (hash) {
    const secretKey = await hmacSha256('WebAppData', botToken)
    const expected = bytesToHex(await hmacSha256(secretKey, checkString))
    if (expected === hash.toLowerCase()) return true
  }

  if (signature) {
    const botId = botToken.split(':')[0]
    const message = encoder.encode(`${botId}:WebAppData\n${checkString}`)
    try {
      return ed25519.verify(
        base64UrlToBytes(signature),
        message,
        hexToBytes(TELEGRAM_PUBLIC_KEY)
      )
    } catch {
      return false
    }
  }

  return false
}
