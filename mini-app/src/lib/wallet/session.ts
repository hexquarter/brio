const PROFILE_SYNCED_KEY = 'wallet_profile_synced'
const PROFILE_OVERRIDES_KEY = 'wallet_profile_overrides'
const PROFILE_FOUND_KEY = 'wallet_profile_found'
const PROFILE_DISMISSED_KEY = 'wallet_profile_dismissed'
const NOSTR_DERIVED_KEY = 'wallet_nostr_derived'

let sessionMnemonic: string | null = null

/**
 * Where the session mnemonic came from. Nostr-derived wallets encode their
 * Nostr secret key as BIP-39 entropy, so their identity must be derived from
 * the entropy itself instead of the NIP-06 path (see deriveNostrIdentity).
 */
export type WalletSource = 'phrase' | 'nostr'

let sessionWalletSource: WalletSource = 'phrase'

export const getSessionMnemonic = () => sessionMnemonic

export const getSessionWalletSource = () => sessionWalletSource

export const storeSessionMnemonic = (mnemonic: string, source: WalletSource = 'phrase') => {
  sessionMnemonic = mnemonic
  sessionWalletSource = source
}

export const clearSessionMnemonic = () => {
  sessionMnemonic = null
  sessionWalletSource = 'phrase'
}

/**
 * Whether the stored wallet was created or recovered from a Nostr key
 * (nsec or bunker). Persisted in localStorage so the Nostr identity can be
 * re-derived after a reload; cleared when the wallet is reset or replaced
 * with a classic recovery-phrase wallet.
 */
export const isNostrDerivedWallet = () => localStorage.getItem(NOSTR_DERIVED_KEY) === 'true'

export const setNostrDerivedWallet = (value: boolean) => {
  if (value) {
    localStorage.setItem(NOSTR_DERIVED_KEY, 'true')
  } else {
    localStorage.removeItem(NOSTR_DERIVED_KEY)
  }
}

export const isProfileSynced = () => sessionStorage.getItem(PROFILE_SYNCED_KEY) === 'true'

export const markProfileSynced = () => {
  sessionStorage.setItem(PROFILE_SYNCED_KEY, 'true')
}

export const clearProfileSynced = () => {
  sessionStorage.removeItem(PROFILE_SYNCED_KEY)
}

/**
 * Profile identity fields imported from an existing Nostr profile (via
 * import or linking). They override the defaults when the profile is
 * (re)published, including the best-effort sync that runs on every wallet
 * unlock. Persisted in localStorage so a linked identity survives new
 * sessions; cleared when the wallet is reset or replaced.
 */
export type ProfileOverrides = {
  name?: string
  display_name?: string
  about?: string
}

export const getProfileOverrides = (): ProfileOverrides => {
  try {
    const stored = localStorage.getItem(PROFILE_OVERRIDES_KEY)
    return stored ? (JSON.parse(stored) as ProfileOverrides) : {}
  } catch {
    return {}
  }
}

export const storeProfileOverrides = (overrides: ProfileOverrides) => {
  try {
    localStorage.setItem(PROFILE_OVERRIDES_KEY, JSON.stringify(overrides))
  } catch (error) {
    console.warn('Unable to store the Nostr profile overrides:', error)
  }
}

export const clearProfileOverrides = () => {
  localStorage.removeItem(PROFILE_OVERRIDES_KEY)
}

/**
 * A previous profile found on the relays for this wallet's key with
 * different identity fields (e.g. after a restore). The user chooses to
 * import it or start fresh; pending state lives in sessionStorage so the
 * choice is asked again next session if left unanswered.
 */
export type FoundProfile = {
  eventId: string
  createdAt: number
}

export const getFoundProfile = (): FoundProfile | null => {
  try {
    const stored = sessionStorage.getItem(PROFILE_FOUND_KEY)
    return stored ? (JSON.parse(stored) as FoundProfile) : null
  } catch {
    return null
  }
}

export const setFoundProfile = (found: FoundProfile) => {
  sessionStorage.setItem(PROFILE_FOUND_KEY, JSON.stringify(found))
}

export const clearFoundProfile = () => {
  sessionStorage.removeItem(PROFILE_FOUND_KEY)
}

// "Start fresh" remembers the ignored profile event so the banner is not
// shown again for the same profile. Cleared when the wallet is reset.
export const getDismissedProfileEventId = () => localStorage.getItem(PROFILE_DISMISSED_KEY)

export const setDismissedProfileEventId = (eventId: string) => {
  localStorage.setItem(PROFILE_DISMISSED_KEY, eventId)
}

export const clearDismissedProfileEventId = () => {
  localStorage.removeItem(PROFILE_DISMISSED_KEY)
}
