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
