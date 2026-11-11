import type { BreezSdk } from '@breeztech/breez-sdk-spark/web'
import { retrieveLaunchParams, retrieveRawInitData } from '@telegram-apps/sdk-react'
import { generateChildKey, generateTapRootAddress, hash } from '@/helpers/crypto'
import { verifyProfile } from '@/lib/wallet/api'
import { markProfileSynced } from '@/lib/wallet/session'
import { publishProfile } from './client'

export const publishAndVerifyProfile = async (
  mnemonic: string,
  sdk: BreezSdk,
  btcAddress: string
) => {
  const telegramUsername = retrieveLaunchParams().tgWebAppData?.user?.username
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

  const childKey = await generateChildKey(mnemonic)
  if (!childKey.publicKey) {
    throw new Error('Cannot retrieve Bitcoin public key.')
  }
  const tapRootAddress = await generateTapRootAddress(childKey.publicKey)

  const contacts = [await hash(telegramUsername.toLowerCase())]
  const profileEvent = await publishProfile(mnemonic, {
    name: telegramUsername,
    display_name: telegramUsername,
    about: 'Brio Bitcoin wallet',
    lud16: lightningAddress.lightningAddress,
    lightningAddress: lightningAddress.lightningAddress,
    lnurl: lightningAddress.lnurl.url,
    btcAddress,
    taprootAddress: tapRootAddress
  }, contacts)

  const response = await verifyProfile({
    nostrPublicKey: profileEvent.pubkey,
    profileEventId: profileEvent.id,
    tgInitData: initData
  })
  if (!response.ok) throw new Error(JSON.stringify(await response.json()))

  markProfileSynced()
  return profileEvent
}
