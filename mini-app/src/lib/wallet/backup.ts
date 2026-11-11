const SECURE_EXPORT_KEY = 'wallet_secure_export'
const SECURE_EXPORT_LATER_KEY = 'wallet_secure_export_later'

/**
 * True once the user has confirmed a recovery-phrase export for the current
 * wallet. This is the only durable backup in a self-custodial setup.
 */
export const hasSecureExport = () => localStorage.getItem(SECURE_EXPORT_KEY) === 'true'

export const markSecureExport = () => {
  localStorage.setItem(SECURE_EXPORT_KEY, 'true')
  sessionStorage.removeItem(SECURE_EXPORT_LATER_KEY)
}

export const clearSecureExport = () => {
  localStorage.removeItem(SECURE_EXPORT_KEY)
  sessionStorage.removeItem(SECURE_EXPORT_LATER_KEY)
}

/** Hide the reminder for the rest of this session without claiming an export. */
export const deferSecureExport = () => {
  sessionStorage.setItem(SECURE_EXPORT_LATER_KEY, 'true')
}

export const isSecureExportDeferred = () => sessionStorage.getItem(SECURE_EXPORT_LATER_KEY) === 'true'
