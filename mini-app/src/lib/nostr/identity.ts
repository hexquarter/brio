import * as bip39 from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { HDKey } from '@scure/bip32'
import { getPublicKey } from 'nostr-tools'
import { isNostrDerivedWallet } from '@/lib/wallet/session'

export type NostrIdentity = {
  secretKey: Uint8Array
  publicKey: string
}

let cachedMnemonic: string | null = null
let cachedIdentity: NostrIdentity | null = null

export const deriveNostrIdentity = async (mnemonic: string): Promise<NostrIdentity> => {
  if (cachedMnemonic === mnemonic && cachedIdentity) return cachedIdentity

  if (isNostrDerivedWallet()) {
    // Wallets recovered from a Nostr connection encode their Nostr secret
    // key as the BIP-39 entropy of the recovery phrase, so the identity is
    // the entropy itself rather than an NIP-06 child key. This keeps the
    // same nsec/bunker restoring the same identity.
    const secretKey = bip39.mnemonicToEntropy(mnemonic, wordlist)
    cachedMnemonic = mnemonic
    cachedIdentity = {
      secretKey,
      publicKey: getPublicKey(secretKey)
    }
    return cachedIdentity
  }

  const seed = await bip39.mnemonicToSeed(mnemonic)
  const root = HDKey.fromMasterSeed(seed)
  const child = root.derive("m/44'/1237'/0'/0/0")
  if (!child.privateKey) throw new Error('Unable to derive the Nostr key from the wallet recovery phrase.')

  const secretKey = new Uint8Array(child.privateKey)
  cachedMnemonic = mnemonic
  cachedIdentity = {
    secretKey,
    publicKey: getPublicKey(secretKey)
  }
  return cachedIdentity
}

export const clearNostrIdentity = () => {
  cachedMnemonic = null
  cachedIdentity = null
}
