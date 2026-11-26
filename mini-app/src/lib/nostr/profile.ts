import type { BreezSdk } from '@breeztech/breez-sdk-spark/web'
import { nip19 } from 'nostr-tools'
import { retrieveRawInitData } from '@telegram-apps/sdk-react'
import { hash } from '@/helpers/crypto'
import { fetchBotInfo, registerPaymentWebhook, rpcEndpoint, verifyProfile, type RegisterWebhookResponse } from '@/lib/wallet/api'
import {
  clearFoundProfile,
  getDismissedProfileEventId,
  getProfileOverrides,
  markProfileSynced,
  storeProfileOverrides,
  type FoundProfile,
  type ProfileOverrides
} from '@/lib/wallet/session'
import { publishProfile, fetchNostrProfile, publishBadgeAcceptance, getNostrConfig } from './client'
import { isMockedTelegramEnv } from '@/lib/telegram/env'
import { getTelegramUsername } from '@/lib/telegram/username'
import { deriveNostrIdentity } from './identity'

export type OwnNostrProfile = {
  npub: string
  publicKey: string
  fetched: Awaited<ReturnType<typeof fetchNostrProfile>>
}

export const fetchOwnNostrProfile = async (mnemonic: string): Promise<OwnNostrProfile> => {
  const identity = await deriveNostrIdentity(mnemonic)
  return {
    npub: nip19.npubEncode(identity.publicKey),
    publicKey: identity.publicKey,
    fetched: await fetchNostrProfile(identity.publicKey)
  }
}

// Accepts an npub, an nprofile, or a raw 64-char hex public key.
export const resolveNostrPublicKeyInput = (input: string): string | null => {
  const value = input.trim()
  if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase()
  try {
    const decoded = nip19.decode(value)
    if (decoded.type === 'npub') return decoded.data as string
    if (decoded.type === 'nprofile') return (decoded.data as { pubkey: string }).pubkey
  } catch {
    // Not a valid Nostr identifier.
  }
  return null
}

/**
 * Detects a previous profile on the relays whose identity fields differ from
 * what this wallet would publish (e.g. after a restore). Returns the found
 * profile reference so the UI can offer to import it instead of overwriting.
 */
export const detectExistingNostrProfile = async (mnemonic: string): Promise<FoundProfile | null> => {
  try {
    const own = await fetchOwnNostrProfile(mnemonic)
    const fetched = own.fetched
    if (!fetched || fetched.eventId === getDismissedProfileEventId()) return null

    const telegramUsername = getTelegramUsername()?.toLowerCase()
    const stored = getProfileOverrides()
    const expectedName = stored.name ?? telegramUsername ?? ''
    const expectedDisplayName = stored.display_name ?? telegramUsername ?? ''
    const expectedAbout = stored.about ?? 'Brio Bitcoin wallet'
    const differs =
      (!!fetched.profile.name && fetched.profile.name !== expectedName) ||
      (!!fetched.profile.display_name && fetched.profile.display_name !== expectedDisplayName) ||
      (!!fetched.profile.about && fetched.profile.about !== expectedAbout)
    return differs ? { eventId: fetched.eventId, createdAt: fetched.createdAt } : null
  } catch (error) {
    console.warn('Unable to check for an existing Nostr profile:', error)
    return null
  }
}

/**
 * Links an existing Nostr profile by npub: imports its identity fields
 * (name, display name, about) as overrides and republishes the wallet
 * profile with them. Payments keep flowing through the wallet's own
 * Lightning address; no secret key is involved.
 */
export const linkExistingNostrProfile = async (
  mnemonic: string,
  sdk: BreezSdk,
  btcAddress: string,
  keyInput: string
) => {
  const publicKey = resolveNostrPublicKeyInput(keyInput)
  if (!publicKey) {
    throw new Error('Invalid Nostr public key. Paste an npub, nprofile or hex key.')
  }

  const fetched = await fetchNostrProfile(publicKey)
  if (!fetched) {
    throw new Error('No profile was found on the relays for this key. Publish a profile from your Nostr client first.')
  }
  if (!fetched.profile.name && !fetched.profile.display_name && !fetched.profile.about) {
    throw new Error('This profile has no name or description to import.')
  }

  const overrides: ProfileOverrides = {
    name: fetched.profile.name,
    display_name: fetched.profile.display_name,
    about: fetched.profile.about
  }
  storeProfileOverrides(overrides)

  const event = await publishAndVerifyProfile(mnemonic, sdk, btcAddress, overrides)
  return { event, npub: nip19.npubEncode(publicKey), imported: fetched.profile }
}

/**
 * Re-publishes the local profile merged with the identity fields (name,
 * display name, about) of the profile already stored on the relays, then
 * re-verifies it with the backend. Wallet addresses and the Lightning
 * address always come from the wallet itself.
 */
export const importNostrProfile = async (
  mnemonic: string,
  sdk: BreezSdk,
  btcAddress: string
) => {
  const own = await fetchOwnNostrProfile(mnemonic)
  if (!own.fetched) {
    throw new Error('No Nostr profile was found on the relays for this wallet.')
  }

  const imported = own.fetched.profile
  const overrides: ProfileOverrides = {
    name: imported.name,
    display_name: imported.display_name,
    about: imported.about
  }
  storeProfileOverrides(overrides)

  const event = await publishAndVerifyProfile(mnemonic, sdk, btcAddress, overrides)
  return { event, imported }
}

export const publishAndVerifyProfile = async (
  mnemonic: string,
  sdk: BreezSdk,
  btcAddress: string,
  overrides?: ProfileOverrides
) => {
  // A website session has no real Telegram identity or init data. Publishing
  // a profile with the synthetic web user would create a bogus Nostr record.
  if (isMockedTelegramEnv()) {
    console.info('Skipping Nostr profile sync outside Telegram.')
    return undefined
  }

  const telegramUsername = getTelegramUsername()
  if (!telegramUsername) {
    throw new Error('A Telegram username is required to be discoverable. Set a username in Telegram and try again.')
  }

  const initData = retrieveRawInitData()
  if (!initData) {
    throw new Error('Cannot retrieve Telegram init data.')
  }

  const lightningAddress = await sdk.getLightningAddress()
  if (!lightningAddress?.lightningAddress || !lightningAddress.lnurl?.url) {
    throw new Error('A Lightning address is required to publish the wallet profile.')
  }

  const contacts = [await hash(telegramUsername.toLowerCase())]
  // NIP-05 identifier + deep link so other Nostr clients verify the wallet
  // and can open the Telegram Mini App from the profile.
  const botUsername = await fetchBotInfo()
    .then(info => info.username)
    .catch(() => undefined)
  const nip05 = `${telegramUsername.toLowerCase()}@${new URL(rpcEndpoint()).hostname}`
  const website = botUsername ? `https://t.me/${botUsername}/app?startapp=wallet` : undefined
  // Identity fields imported from Nostr (or passed in directly) take
  // precedence over the Telegram defaults.
  const stored = getProfileOverrides()
  const name = overrides?.name ?? stored.name ?? telegramUsername
  const displayName = overrides?.display_name ?? stored.display_name ?? telegramUsername
  const about = overrides?.about ?? stored.about ?? 'Brio Bitcoin wallet'
  const profileEvent = await publishProfile(mnemonic, {
    name,
    display_name: displayName,
    about,
    lud16: lightningAddress.lightningAddress,
    lightningAddress: lightningAddress.lightningAddress,
    lnurl: lightningAddress.lnurl.url,
    btcAddress,
    nip05,
    website
  }, contacts)

  const response = await verifyProfile({
    nostrPublicKey: profileEvent.pubkey,
    profileEventId: profileEvent.id,
    tgInitData: initData
  })
  if (!response.ok) throw new Error(JSON.stringify(await response.json()))

  markProfileSynced()
  clearFoundProfile()

  // Best-effort extras: badge acceptance and offline-payment webhooks must
  // never fail the profile sync itself.
  try {
    const config = await getNostrConfig()
    if (config.servicePublicKey) {
      await publishBadgeAcceptance(mnemonic, `30009:${config.servicePublicKey}:brio-verified`)
    }
  } catch (error) {
    console.warn('Unable to accept the Brio badge:', error)
  }
  try {
    await registerPaymentWebhookForWallet(mnemonic, sdk, btcAddress)
  } catch (error) {
    console.warn('Unable to register the payment webhook:', error)
  }

  return profileEvent
}

/**
 * Registers the wallet's offline-payment webhook with the Breez backend.
 * The backend generates a per-wallet token and returns the URL the SDK
 * should be called on; incoming Lightning receives and static (on-chain)
 * deposits then trigger a Telegram DM even when the app is closed.
 */
export const registerPaymentWebhookForWallet = async (
  mnemonic: string,
  sdk: BreezSdk,
  btcAddress?: string
) => {
  if (isMockedTelegramEnv()) return undefined

  const initData = retrieveRawInitData()
  if (!initData) throw new Error('Cannot retrieve Telegram init data.')

  const identity = await deriveNostrIdentity(mnemonic)
  const lightningAddress = await sdk.getLightningAddress()

  const response = await registerPaymentWebhook({
    nostrPublicKey: identity.publicKey,
    btcAddress,
    lightningAddress: lightningAddress?.lightningAddress
  })
  if (!response.ok) throw new Error(JSON.stringify(await response.json()))
  const { webhookUrl, secret } = await response.json() as RegisterWebhookResponse
  if (!webhookUrl || !secret) return undefined

  return sdk.registerWebhook({
    url: webhookUrl,
    secret,
    eventTypes: [
      { type: 'lightningReceiveFinished' },
      { type: 'staticDepositFinished' }
    ]
  })
}
