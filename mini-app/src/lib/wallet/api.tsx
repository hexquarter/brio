import { retrieveRawInitData } from '@telegram-apps/sdk-react'
import { verifyEvent, type Event as NostrEvent } from 'nostr-tools'

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

// Fiat currencies quoted by the PriceStr feed. Keep the settings selector in
// sync with this list so every option can be priced from the relay.
export const FIAT_CURRENCIES = [
    'USD',
    'EUR',
    'GBP',
    'JPY',
    'CAD',
    'CHF',
    'CNY',
    'KRW',
    'AUD',
    'NZD',
    'SGD',
    'INR',
    'ZAR',
    'SEK',
    'MXN'
] as const

export const isSupportedCurrency = (currency: string) =>
    (FIAT_CURRENCIES as readonly string[]).includes(currency.toUpperCase())

// PriceStr publishes a signed Bitcoin price event to its Nostr relay every
// 10 seconds. The event carries the BTC/USD median plus fiat FX rates, so a
// single relay subscription covers every supported display currency.
const PRICESTR_RELAY_URL = 'wss://relay.pricestr.xyz'
const PRICESTR_KIND = 30078
const PRICESTR_PUBKEY = 'c6326ba648f2645f419a63e03c525b3547688a3aadab82c9678c18258eb71239'
const PRICESTR_TIMEOUT_MS = 4_000

type PricestrSnapshot = {
    median: number
    fxRates: Record<string, number>
    fetchedAt: number
}

let pricestrSnapshot: PricestrSnapshot | null = null
let pricestrRequest: Promise<PricestrSnapshot | null> | null = null

const requestPricestrEvent = () => new Promise<NostrEvent | null>((resolve) => {
    if (typeof WebSocket === 'undefined') {
        resolve(null)
        return
    }

    let socket: WebSocket | null = null
    let settled = false
    const finish = (event: NostrEvent | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try { socket?.close() } catch { /* ignore */ }
        resolve(event)
    }
    const timer = setTimeout(() => finish(null), PRICESTR_TIMEOUT_MS)

    try {
        socket = new WebSocket(PRICESTR_RELAY_URL)
    } catch {
        finish(null)
        return
    }

    socket.onopen = () => {
        const subscriptionId = `pricestr-${Date.now()}`
        socket?.send(JSON.stringify([
            'REQ',
            subscriptionId,
            { kinds: [PRICESTR_KIND], limit: 10 }
        ]))
    }

    socket.onmessage = (message) => {
        let data: unknown
        try {
            data = JSON.parse(String(message.data))
        } catch {
            return
        }
        if (!Array.isArray(data)) return

        if (data[0] === 'EVENT' && data[2]) {
            const event = data[2] as NostrEvent
            if (
                event.kind === PRICESTR_KIND &&
                event.pubkey === PRICESTR_PUBKEY &&
                verifyEvent(event)
            ) {
                finish(event)
            }
            return
        }

        if (data[0] === 'EOSE' || data[0] === 'CLOSED') {
            finish(null)
        }
    }

    socket.onerror = () => finish(null)
    socket.onclose = () => finish(null)
})

const parsePricestrEvent = (event: NostrEvent): PricestrSnapshot | null => {
    const isUsd = event.tags.some(tag => tag[0] === 'currency' && tag[1] === 'USD')
    if (!isUsd) return null

    try {
        const content = JSON.parse(event.content) as { median?: unknown; fxRates?: unknown }
        const median = content.median
        if (typeof median !== 'number' || !Number.isFinite(median) || median <= 0) return null

        const fxRates: Record<string, number> = {}
        if (content.fxRates && typeof content.fxRates === 'object') {
            for (const [key, value] of Object.entries(content.fxRates)) {
                if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
                    fxRates[key.toUpperCase()] = value
                }
            }
        }

        return { median, fxRates, fetchedAt: Date.now() }
    } catch {
        return null
    }
}

const getPricestrSnapshot = async () => {
    if (pricestrSnapshot && Date.now() - pricestrSnapshot.fetchedAt < PRICE_TTL_MS) {
        return pricestrSnapshot
    }
    if (!pricestrRequest) {
        pricestrRequest = requestPricestrEvent()
            .then(event => (event ? parsePricestrEvent(event) : null))
            .then(snapshot => {
                if (snapshot) pricestrSnapshot = snapshot
                return snapshot
            })
            .catch(() => null)
            .finally(() => { pricestrRequest = null })
    }
    return pricestrRequest
}

const fetchPricestrPrice = async (code: string) => {
    const snapshot = await getPricestrSnapshot()
    if (!snapshot) {
        throw new Error('Unable to fetch the Bitcoin price from PriceStr.')
    }

    // The median is quoted in USD; fxRates convert one USD into the target
    // currency.
    const rate = code === 'USD' ? 1 : snapshot.fxRates[code]
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
        throw new Error(`PriceStr does not quote ${code}.`)
    }

    return snapshot.median * rate
}

export const fetchPrice = async (currency: string) => {
    const code = currency.toUpperCase()
    const cached = priceCache.get(code)
    if (cached && Date.now() - cached.fetchedAt < PRICE_TTL_MS) return cached.price

    const price = await fetchPricestrPrice(code)

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
