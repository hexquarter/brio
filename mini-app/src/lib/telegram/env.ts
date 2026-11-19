/**
 * Tracks whether the Telegram environment was synthesised for a normal web
 * browser. In that mode Telegram-native features (Main Button, haptics,
 * SecureStorage, Telegram profile publishing) must stay disabled.
 */
let mockedTelegramEnv = false

export const setMockedTelegramEnv = (value: boolean) => {
    mockedTelegramEnv = value
}

export const isMockedTelegramEnv = () => mockedTelegramEnv

/**
 * Detects a real Telegram Mini App session synchronously.
 *
 * Telegram always appends launch parameters to the Mini App URL, and every
 * client exposes at least one global bridge. We deliberately do not use
 * `isTMA('complete')` here: its fallback is a bridge round-trip with a 100 ms
 * timeout, which fails on Telegram Desktop and slower devices and would make
 * the app fall back to WebAuthn (unusable in a WebView).
 *
 * localStorage is intentionally ignored. A previous web visit stores
 * synthetic launch params there, which must not make a later web visit look
 * like Telegram.
 */
export const isTelegramEnvironment = () => {
    try {
        const href = window.location.href
        if (href.includes('tgWebAppData=') || href.includes('tgWebAppVersion=')) {
            return true
        }
        // Telegram's official web-app script creates Telegram.WebApp and
        // Telegram.WebView on every page, including plain browsers, so those
        // globals cannot identify a real Mini App. TelegramWebviewProxy is
        // injected only by native Telegram clients.
        const global = window as Window & { TelegramWebviewProxy?: unknown }
        return !!global.TelegramWebviewProxy
    } catch {
        return false
    }
}
