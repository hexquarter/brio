import { nip05, nip19 } from 'nostr-tools'
import { fetchNostrProfile, lookupProfile } from './client'

/**
 * Resolves a payment recipient entered in the send flow. This is the
 * Telegram <-> Nostr gateway from the sending side: a Brio wallet can pay
 * - a Telegram handle (service attestation lookup, as before),
 * - an npub / nprofile / hex key (kind 0 profile on the relays),
 * - a NIP-05 identifier (name@domain),
 * - a plain Lightning address (e.g. npub1…@npub.cash), whose npub is
 *   decoded directly when the local part is one.
 */
export type ResolvedRecipient = {
  // What to show as the recipient, e.g. '@handle', 'name@domain', 'npub1…abc'
  label: string
  // Nostr public key when one could be resolved (hex)
  publicKey?: string
  // Lightning address or LNURL-pay endpoint for the Breez SDK
  address: string
  btcAddress?: string
  // True when resolved through a Telegram handle (payment receipts are
  // addressed by the contact hash tag).
  isTelegramHandle: boolean
}

const HEX_PUBKEY_PATTERN = /^[0-9a-f]{64}$/i
const NPUB_PATTERN = /^npub1[02-9ac-hj-np-z]+$/i
const NPROFILE_PATTERN = /^nprofile1[02-9ac-hj-np-z]+$/i
const LIGHTNING_ADDRESS_PATTERN = /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/

const shortenNpub = (pubkey: string): string => {
  try {
    const npub = nip19.npubEncode(pubkey)
    return `${npub.slice(0, 12)}…${npub.slice(-6)}`
  } catch {
    return `${pubkey.slice(0, 10)}…${pubkey.slice(-6)}`
  }
}

const pickAddress = (profile?: {
  lightningAddress?: string
  lud16?: string
  lnurl?: string
}): string | undefined =>
  profile?.lightningAddress ?? profile?.lud16 ?? profile?.lnurl

const profileFromPublicKey = async (
  publicKey: string
): Promise<ResolvedRecipient | null> => {
  const fetched = await fetchNostrProfile(publicKey)
  const address = pickAddress(fetched?.profile)
  if (!address) return null
  return {
    label: shortenNpub(publicKey),
    publicKey,
    address,
    btcAddress: fetched?.profile.btcAddress,
    isTelegramHandle: false
  }
}

// A Lightning address whose local part is an npub (e.g. npub1…@npub.cash)
// carries the recipient key inline; no relay lookup is needed for it.
const npubFromAddressLocalPart = (input: string): string | null => {
  const local = input.split('@')[0]
  if (!NPUB_PATTERN.test(local)) return null
  try {
    const decoded = nip19.decode(local)
    if (decoded.type === 'npub') return decoded.data as string
  } catch {
    // Bech32 failure — treat the input as a plain Lightning address.
  }
  return null
}

export const resolveRecipient = async (rawInput: string): Promise<ResolvedRecipient | null> => {
  const input = rawInput.trim()
  if (!input) return null

  if (LIGHTNING_ADDRESS_PATTERN.test(input)) {
    const inlinePubkey = npubFromAddressLocalPart(input)
    if (inlinePubkey) {
      return {
        label: input,
        publicKey: inlinePubkey,
        address: input,
        isTelegramHandle: false
      }
    }

    // NIP-05 identifier: resolve to a key, then read the profile so payments
    // are attributed to the Nostr identity, not just the address.
    try {
      const pointer = await nip05.queryProfile(input)
      if (pointer?.pubkey) {
        const resolved = await profileFromPublicKey(pointer.pubkey)
        if (resolved) return { ...resolved, label: input }
      }
    } catch {
      // Domain doesn't answer NIP-05 — fall through to the plain address.
    }
    return { label: input, address: input, isTelegramHandle: false }
  }

  if (NPUB_PATTERN.test(input) || NPROFILE_PATTERN.test(input) || HEX_PUBKEY_PATTERN.test(input)) {
    let publicKey: string | null = null
    if (HEX_PUBKEY_PATTERN.test(input)) {
      publicKey = input.toLowerCase()
    } else {
      try {
        const decoded = nip19.decode(input)
        if (decoded.type === 'npub') publicKey = decoded.data as string
        if (decoded.type === 'nprofile') publicKey = (decoded.data as { pubkey: string }).pubkey
      } catch {
        return null
      }
    }
    if (!publicKey) return null
    return profileFromPublicKey(publicKey)
  }

  // Bare Telegram handle (with or without @): the original service-attestation
  // lookup via the relay.
  const stripped = input.startsWith('@') ? input.slice(1) : input
  const found = await lookupProfile(stripped)
  if (!found) return null
  return {
    label: `@${stripped}`,
    publicKey: found.publicKey,
    address: found.address,
    btcAddress: found.btcAddress,
    isTelegramHandle: true
  }
}
