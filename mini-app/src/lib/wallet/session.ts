const PROFILE_SYNCED_KEY = 'wallet_profile_synced'

let sessionMnemonic: string | null = null

export const getSessionMnemonic = () => sessionMnemonic

export const storeSessionMnemonic = (mnemonic: string) => {
  sessionMnemonic = mnemonic
}

export const clearSessionMnemonic = () => {
  sessionMnemonic = null
}

export const isProfileSynced = () => sessionStorage.getItem(PROFILE_SYNCED_KEY) === 'true'

export const markProfileSynced = () => {
  sessionStorage.setItem(PROFILE_SYNCED_KEY, 'true')
}

export const clearProfileSynced = () => {
  sessionStorage.removeItem(PROFILE_SYNCED_KEY)
}
