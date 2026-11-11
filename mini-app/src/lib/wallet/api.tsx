import { retrieveRawInitData } from '@telegram-apps/sdk-react'

export const rpcEndpoint = () =>
    import.meta.env.DEV ? 'http://localhost:3000' : import.meta.env.VITE_BACKEND_ENDPOINT

type VerifyProfileParams = {
    nostrPublicKey: string
    profileEventId: string
    tgInitData: string
}

export type BotInfo = {
    username: string
}

const rpc = (operation: string, payload: Record<string, unknown>) =>
    fetch(new URL('/rpc', rpcEndpoint()), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
        },
        body: JSON.stringify({ operation, payload })
    })

export const normalizeContact = (contact: string) => {
    const value = contact.trim().replace(/\s+/g, '')
    if (value.startsWith('@')) return value.slice(1).toLowerCase()
    if (/^\+?\d+$/.test(value)) return value.startsWith('+') ? value : `+${value}`
    return value.toLowerCase()
}

export const verifyProfile = (params: VerifyProfileParams) =>
    rpc('verify-profile', params)

export const notifyPayment = async (paymentEventId: string) =>
    rpc('notify-payment', {
        paymentEventId,
        tgInitData: retrieveRawInitData()
    })

const priceCache = new Map<string, { price: number; fetchedAt: number }>()
const PRICE_TTL_MS = 15_000

export const fetchPrice = async (currency: string) => {
    const code = currency.toLowerCase()
    const cached = priceCache.get(code)
    if (cached && Date.now() - cached.fetchedAt < PRICE_TTL_MS) return cached.price

    const url = new URL('https://api.coingecko.com/api/v3/simple/price')
    url.searchParams.set('ids', 'bitcoin')
    url.searchParams.set('vs_currencies', code)

    const headers: Record<string, string> = { Accept: 'application/json' }
    if (import.meta.env.VITE_COINGECKO_DEMO_API_KEY) {
        headers['x-cg-demo-api-key'] = import.meta.env.VITE_COINGECKO_DEMO_API_KEY
    }

    const response = await fetch(url, { headers })
    if (!response.ok) {
        throw new Error(`Unable to fetch the Bitcoin price (${response.status}).`)
    }

    const body = await response.json() as { bitcoin?: Record<string, number> }
    const price = body.bitcoin?.[code]
    if (typeof price !== 'number') {
        throw new Error(`No Bitcoin price is available for ${currency}.`)
    }

    priceCache.set(code, { price, fetchedAt: Date.now() })
    return price
}

export const fetchBotInfo = async (): Promise<BotInfo> => {
    if (import.meta.env.VITE_TELEGRAM_BOT_USERNAME) {
        return { username: import.meta.env.VITE_TELEGRAM_BOT_USERNAME }
    }

    const response = await rpc('bot-info', {})
    if (response.ok) return response.json() as Promise<BotInfo>
    throw new Error(JSON.stringify(await response.json()))
}
