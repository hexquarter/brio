import * as bip39 from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { BunkerSigner, parseBunkerInput } from 'nostr-tools/nip46'
import { hexToBytes } from 'nostr-tools/utils'

/**
 * Recovers a wallet from an existing Nostr connection. The wallet's BIP-39
 * recovery phrase is derived deterministically from the Nostr key, so the
 * same nsec — or the same bunker account signing the same fixed challenge —
 * always restores the exact same wallet (and its Nostr identity).
 */

// The event a bunker is asked to sign to derive the wallet seed. Every field
// is fixed, so the event id (a SHA-256 of the serialized template) is stable
// across attempts and devices regardless of the ephemeral client key used to
// talk to the bunker. The event itself is never published.
const BUNKER_SEED_CHALLENGE = {
  kind: 1,
  created_at: 0,
  tags: [],
  content: 'brio:wallet-seed:v1'
}

export type NostrRecovery = {
  mnemonic: string
  // The Nostr public key that represents the connection (the nsec's key, or
  // the bunker's signing key). Hex.
  publicKey: string
  bunker: boolean
}

export const mnemonicFromNostrSecretKey = (secretKey: Uint8Array): string =>
  bip39.entropyToMnemonic(secretKey, wordlist)

/**
 * The Nostr identity a wallet recovered this way will use. For Nostr-derived
 * wallets the identity is the phrase's entropy itself (not an NIP-06 child
 * key), so it can be previewed before the wallet is stored.
 */
export const nostrPublicKeyFromMnemonic = (mnemonic: string): string =>
  getPublicKey(bip39.mnemonicToEntropy(mnemonic, wordlist))

export const npubFromMnemonicEntropy = (mnemonic: string): string =>
  nip19.npubEncode(nostrPublicKeyFromMnemonic(mnemonic))

export const npubFromNostrSecretKey = (secretKey: Uint8Array): string =>
  nip19.npubEncode(getPublicKey(secretKey))

// Accepts an nsec or a raw 64-character hex secret key.
export const resolveNostrSecretKeyInput = (input: string): Uint8Array | null => {
  const value = input.trim().toLowerCase()
  if (/^[0-9a-f]{64}$/.test(value)) return hexToBytes(value)
  try {
    const decoded = nip19.decode(value)
    if (decoded.type === 'nsec') return decoded.data as Uint8Array
  } catch {
    // Not a valid Nostr identifier.
  }
  return null
}

export const recoverWalletFromNsec = (input: string): NostrRecovery | null => {
  const secretKey = resolveNostrSecretKeyInput(input)
  if (!secretKey || secretKey.length !== 32) return null
  return {
    mnemonic: mnemonicFromNostrSecretKey(secretKey),
    publicKey: getPublicKey(secretKey),
    bunker: false
  }
}

/**
 * Connects to an NIP-46 bunker (`bunker://` URI, or a NIP-05 identifier
 * backed by a bunker), asks it for its public key and a signature over the
 * fixed seed challenge, then derives the wallet phrase from the signature.
 * The bunker never reveals its secret key.
 */
export const recoverWalletFromBunker = async (input: string): Promise<NostrRecovery> => {
  const pointer = await parseBunkerInput(input.trim())
  if (!pointer) {
    throw new Error('Invalid bunker connection. Paste a bunker:// URI or a bunker-backed NIP-05 identifier.')
  }

  const signer = BunkerSigner.fromBunker(generateSecretKey(), pointer)
  try {
    await signer.connect()
    const publicKey = await signer.getPublicKey()
    const event = await signer.signEvent(BUNKER_SEED_CHALLENGE)
    return {
      mnemonic: mnemonicFromNostrSecretKey(hexToBytes(event.id)),
      publicKey,
      bunker: true
    }
  } finally {
    try {
      await signer.close()
    } catch (error) {
      console.warn('Unable to close the bunker connection:', error)
    }
  }
}
