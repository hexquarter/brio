const PROFILE_SYNCED_KEY = 'wallet_profile_synced'
const PROFILE_OVERRIDES_KEY = 'wallet_profile_overrides'

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

/**
 * Profile identity fields imported from an existing Nostr profile. They
 * override the defaults when the profile is (re)published, including the
 * best-effort sync that runs on every wallet unlock.
 */
export type ProfileOverrides = {
  name?: string
  display_name?: string
  about?: string
}

export const getProfileOverrides = (): ProfileOverrides => {
  try {
    const stored = sessionStorage.getItem(PROFILE_OVERRIDES_KEY)
    return stored ? (JSON.parse(stored) as ProfileOverrides) : {}
  } catch {
    return {}
  }
}

export const storeProfileOverrides = (overrides: ProfileOverrides) => {
  try {
    sessionStorage.setItem(PROFILE_OVERRIDES_KEY, JSON.stringify(overrides))
  } catch (error) {
    console.warn('Unable to store the Nostr profile overrides:', error)
  }
}

export const clearProfileOverrides = () => {
  sessionStorage.removeItem(PROFILE_OVERRIDES_KEY)
}
