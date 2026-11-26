import type { Env } from './env.js'

/**
 * Minimal Cashu mint client (NUT-04 bolt11 mint quotes) used by the npubcash
 * coordinator. The backend never mints or holds ecash itself: it only creates
 * mint quotes and observes their payment state. The recipient's wallet mints
 * the proofs directly against the mint.
 */

const DEFAULT_MINT_URL = 'https://mint.minibits.cash/Bitcoin'

export type MintQuoteState = 'UNPAID' | 'PAID' | 'ISSUED'

export type CreatedMintQuote = {
  quote: string
  invoice: string
}

export type MintQuoteStatus = {
  quote: string
  invoice?: string
  state: MintQuoteState
  paid: boolean
  preimage?: string
}

export const getCashuMintUrl = (env: Env) => {
  const configured = env.CASHU_MINT_URL?.trim()
  return configured || DEFAULT_MINT_URL
}

const mintError = (status: number, body: string) =>
  new Error(`Cashu mint request failed (${status}): ${body.slice(0, 200)}`)

// NUT endpoints are absolute paths, so a mint URL with a path prefix
// (e.g. https://mint.minibits.cash/Bitcoin) must be joined by concatenation,
// not with new URL(path, base) which replaces the whole path.
const mintUrlJoin = (mintUrl: string, path: string) =>
  `${mintUrl.replace(/\/+$/, '')}${path}`

// NUT-04: POST /v1/mint/quote/bolt11
export const createMintQuote = async (
  env: Env,
  input: { amountSats: number; description?: string; mintUrl?: string }
): Promise<CreatedMintQuote> => {
  const mintUrl = input.mintUrl ?? getCashuMintUrl(env)
  const response = await fetch(mintUrlJoin(mintUrl, '/v1/mint/quote/bolt11'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      unit: 'sat',
      amount: input.amountSats,
      ...(input.description ? { description: input.description } : {})
    })
  })
  const body = await response.text()
  if (!response.ok) throw mintError(response.status, body)
  const data = JSON.parse(body) as { quote?: string; request?: string }
  if (!data.quote || !data.request) {
    throw new Error(`Cashu mint returned an unexpected mint quote: ${body.slice(0, 200)}`)
  }
  return { quote: data.quote, invoice: data.request }
}

// NUT-04: GET /v1/mint/quote/bolt11/<quote_id>
export const getMintQuote = async (
  env: Env,
  quote: string,
  mintUrl?: string
): Promise<MintQuoteStatus> => {
  const url = mintUrl ?? getCashuMintUrl(env)
  const response = await fetch(mintUrlJoin(url, `/v1/mint/quote/bolt11/${encodeURIComponent(quote)}`))
  const body = await response.text()
  if (!response.ok) throw mintError(response.status, body)
  const data = JSON.parse(body) as {
    quote?: string
    state?: string
    paid?: boolean
    payment_preimage?: string
    request?: string
  }
  const state = (data.state ?? (data.paid ? 'PAID' : 'UNPAID')).toUpperCase() as MintQuoteState
  return {
    quote: data.quote ?? quote,
    invoice: data.request,
    state: state === 'PAID' || state === 'ISSUED' ? state : 'UNPAID',
    paid: state === 'PAID' || state === 'ISSUED',
    preimage: data.payment_preimage
  }
}
