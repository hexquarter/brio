import * as bip39 from '@scure/bip39'
import { HDKey } from '@scure/bip32'
import { getPublicKey } from 'nostr-tools'

export type NostrIdentity = {
  secretKey: Uint8Array
  publicKey: string
}

let cachedMnemonic: string | null = null
let cachedIdentity: NostrIdentity | null = null

export const deriveNostrIdentity = async (mnemonic: string): Promise<NostrIdentity> => {
  if (cachedMnemonic === mnemonic && cachedIdentity) return cachedIdentity

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
