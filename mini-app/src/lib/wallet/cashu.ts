import { Amount, Wallet, type Proof } from '@cashu/cashu-ts'
import type { BreezSdk } from '@breeztech/breez-sdk-spark/web'
import type { NpubcashQuote } from '@/lib/wallet/npubcash'

/**
 * Claims a settled npubcash quote and sweeps it straight into the
 * self-custodial Spark wallet, so ecash only exists for a moment:
 *
 *   1. mint the ecash proofs for the paid quote at the mint,
 *   2. request a bolt11 invoice from Spark (the self-custodial wallet),
 *   3. melt the proofs at the mint to pay that invoice.
 *
 * If a step fails after minting, the proofs are kept in a local pocket
 * (bearer ecash in localStorage) instead of being lost, and can be swept
 * later.
 */

// Proofs are grouped by mint so a pocket sweep knows which mint to talk to.
type PocketEntry = {
  mintUrl: string
  proofs: Proof[]
}

const POCKET_KEY = 'wallet_cashu_pocket'

// cashu-ts v4 types amounts as `AmountLike`; normalize to plain sats numbers.
const satsOf = (value: number | bigint | string | Amount): number => Amount.from(value).toNumber()

export const getPocket = (): PocketEntry[] => {
  try {
    const raw = localStorage.getItem(POCKET_KEY)
    return raw ? (JSON.parse(raw) as PocketEntry[]) : []
  } catch {
    return []
  }
}

const savePocket = (entries: PocketEntry[]) => {
  try {
    if (entries.length) {
      localStorage.setItem(POCKET_KEY, JSON.stringify(entries))
    } else {
      localStorage.removeItem(POCKET_KEY)
    }
  } catch (error) {
    console.warn('Unable to store the local ecash pocket:', error)
  }
}

const addToPocket = (mintUrl: string, proofs: Proof[]) => {
  if (!proofs.length) return
  const entries = getPocket()
  const existing = entries.find(entry => entry.mintUrl === mintUrl)
  if (existing) {
    existing.proofs.push(...proofs)
  } else {
    entries.push({ mintUrl, proofs })
  }
  savePocket(entries)
}

const removeFromPocket = (mintUrl: string, dropped: Proof[]) => {
  const droppedKeys = new Set(dropped.map(proof => `${proof.id}:${proof.secret}`))
  const entries = getPocket()
    .map(entry => entry.mintUrl === mintUrl
      ? { ...entry, proofs: entry.proofs.filter(proof => !droppedKeys.has(`${proof.id}:${proof.secret}`)) }
      : entry)
    .filter(entry => entry.proofs.length)
  savePocket(entries)
}

export const pocketSats = (): number =>
  getPocket().reduce((total, entry) =>
    total + entry.proofs.reduce((sum, proof) => sum + satsOf(proof.amount), 0), 0)

const loadWallet = async (mintUrl: string): Promise<Wallet> => {
  const wallet = new Wallet(mintUrl, { unit: 'sat' })
  await wallet.loadMint()
  return wallet
}

const receiveSparkInvoice = async (sdk: BreezSdk, amountSats: number, description: string) => {
  const receive = await sdk.receivePayment({
    paymentMethod: {
      type: 'bolt11Invoice',
      amountSats,
      description
    }
  })
  return receive.paymentRequest
}

/**
 * Sweeps the local ecash pocket (oldest entry first) into Spark. Used after
 * a partial claim or for leftover change.
 */
export const sweepPocketIntoSpark = async (sdk: BreezSdk): Promise<ClaimSummary | null> => {
  const entry = getPocket()[0]
  if (!entry) return null

  const totalSats = entry.proofs.reduce((sum, proof) => sum + satsOf(proof.amount), 0)
  if (totalSats <= 0) return null

  const wallet = await loadWallet(entry.mintUrl)
  const invoice = await receiveSparkInvoice(sdk, totalSats, 'Brio ecash sweep')
  const meltQuote = await wallet.createMeltQuoteBolt11(invoice)
  const needed = Amount.from(meltQuote.amount).add(meltQuote.fee_reserve).toNumber()
  const { send } = wallet.selectProofsToSend(entry.proofs, needed, true)
  if (!send.length) {
    throw new Error('Melt fees exceed the parked ecash amount.')
  }
  const melt = await wallet.meltProofsBolt11(meltQuote, send)
  removeFromPocket(entry.mintUrl, send)
  const change = melt.change ?? []
  if (change.length) addToPocket(entry.mintUrl, change)

  return {
    quote: 'pocket',
    claimedSats: satsOf(meltQuote.amount),
    feeSats: satsOf(meltQuote.fee_reserve),
    changeSats: change.reduce((sum, proof) => sum + satsOf(proof.amount), 0)
  }
}

export type ClaimSummary = {
  quote: string
  claimedSats: number
  feeSats: number
  changeSats: number
}

/**
 * Claims one settled quote: mints the ecash and immediately sweeps it into
 * Spark. Throws with a user-presentable message when the flow fails.
 */
export const claimNpubcashQuote = async (
  sdk: BreezSdk,
  quote: NpubcashQuote
): Promise<ClaimSummary> => {
  if (quote.state !== 'PAID' && quote.state !== 'ISSUED') {
    throw new Error('This payment has not settled yet.')
  }

  // 1. Mint the ecash proofs for the paid quote.
  const wallet = await loadWallet(quote.mintUrl)
  const proofs = await wallet.mintProofsBolt11(quote.amountSats, quote.quote)

  // 2. Ask the self-custodial Spark wallet for an invoice.
  let invoice: string
  try {
    invoice = await receiveSparkInvoice(
      sdk,
      quote.amountSats,
      'Brio Nostr address claim'
    )
  } catch (error) {
    addToPocket(quote.mintUrl, proofs)
    throw new Error(`Could not create the sweep invoice: ${(error as Error).message}`)
  }

  // 3. Melt the proofs at the mint, paying the Spark invoice.
  try {
    const meltQuote = await wallet.createMeltQuoteBolt11(invoice)
    const needed = Amount.from(meltQuote.amount).add(meltQuote.fee_reserve).toNumber()
    const { send, keep } = wallet.selectProofsToSend(proofs, needed, true)
    if (!send.length) {
      throw new Error('Melt fees exceed the payment amount.')
    }
    const melt = await wallet.meltProofsBolt11(meltQuote, send)

    const change = melt.change ?? []
    // Proofs not consumed by this melt (overpaid input or change) remain
    // spendable ecash — pocket them so they can be swept later.
    const usedKeys = new Set(send.map(proof => `${proof.id}:${proof.secret}`))
    const leftover = [...proofs, ...keep].filter(proof => !usedKeys.has(`${proof.id}:${proof.secret}`))
    if (leftover.length) addToPocket(quote.mintUrl, leftover)
    if (change.length) addToPocket(quote.mintUrl, change)

    return {
      quote: quote.quote,
      claimedSats: satsOf(meltQuote.amount),
      feeSats: satsOf(meltQuote.fee_reserve),
      changeSats:
        change.reduce((sum, proof) => sum + satsOf(proof.amount), 0) +
        leftover.reduce((sum, proof) => sum + satsOf(proof.amount), 0)
    }
  } catch (error) {
    addToPocket(quote.mintUrl, proofs)
    throw error instanceof Error ? error : new Error(String(error))
  }
}
