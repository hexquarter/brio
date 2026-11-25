import { retrieveLaunchParams } from '@telegram-apps/sdk-react'

/**
 * Returns the current Telegram username (without the @), or null when it is
 * unavailable (e.g. plain web sessions outside Telegram).
 */
export const getTelegramUsername = (): string | null => {
    try {
        return retrieveLaunchParams().tgWebAppData?.user?.username ?? null
    } catch {
        return null
    }
}
