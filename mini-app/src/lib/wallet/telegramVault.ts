/**
 * Wallet storage for Telegram Mini Apps.
 *
 * Telegram's WebViews do not expose WebAuthn, so a passkey-sealed vault cannot
 * be opened inside a Mini App. Bot API 9.0+ provides `SecureStorage` instead:
 * a per-bot key/value store backed by the iOS Keychain or Android Keystore.
 *
 * We keep the same defense-in-depth shape as the browser vault: a random
 * AES-GCM key lives in SecureStorage, and the mnemonic is encrypted with it.
 * Both the key and the encrypted vault are stored in SecureStorage, which is
 * encrypted at rest by the platform and inaccessible to other apps.
 */

import { isMockedTelegramEnv } from '@/lib/telegram/env'

type StorageCallback<T> = (error: Error | null, value?: T) => void

type SecureStorageApi = {
    setItem(key: string, value: string, callback?: StorageCallback<boolean>): unknown
    getItem(key: string, callback: StorageCallback<string | null>): unknown
    removeItem(key: string, callback?: StorageCallback<boolean>): unknown
}

type TelegramWebApp = {
    SecureStorage?: SecureStorageApi
}

type TelegramWindow = Window & {
    Telegram?: { WebApp?: TelegramWebApp }
}

type TelegramVault = {
    version: 3
    iv: string
    ciphertext: string
}

const VAULT_KEY = 'brio_wallet_vault'
const BACKUP_KEY = 'brio_wallet_vault_backup'
const ENCRYPTION_KEY = 'brio_wallet_encryption_key'
const CALL_TIMEOUT_MS = 10000

const encode = (value: Uint8Array) =>
    btoa(Array.from(value, byte => String.fromCharCode(byte)).join(''))

const decode = (value: string) =>
    Uint8Array.from(atob(value), character => character.charCodeAt(0))

const secureStorage = (): SecureStorageApi | null => {
    try {
        const storage = (window as TelegramWindow).Telegram?.WebApp?.SecureStorage
        if (!storage
            || typeof storage.getItem !== 'function'
            || typeof storage.setItem !== 'function'
            || typeof storage.removeItem !== 'function') {
            return null
        }
        return storage
    } catch {
        return null
    }
}

/** True when the current client exposes Telegram's native SecureStorage. */
export const isTelegramVaultAvailable = () => secureStorage() !== null

/**
 * Explains why a Telegram client cannot store the wallet, so the UI can point
 * users to an update or to recovery-phrase restore instead of a WebAuthn error.
 */
export const telegramVaultUnavailableReason = (): string | null => {
    if (isTelegramVaultAvailable() || isMockedTelegramEnv()) return null
    try {
        if (!(window as TelegramWindow).Telegram?.WebApp) return null
    } catch {
        return null
    }
    return 'This Telegram version does not support secure wallet storage. Update Telegram to the latest version, open Brio in Safari or Chrome to use a passkey, or restore your wallet with your recovery phrase.'
}

const call = <T>(operation: (callback: StorageCallback<T>) => void): Promise<T | undefined> =>
    new Promise((resolve, reject) => {
        let settled = false
        const finish = (error: Error | null, value?: T) => {
            if (settled) return
            settled = true
            window.clearTimeout(timer)
            if (error) reject(error)
            else resolve(value)
        }
        const timer = window.setTimeout(
            () => finish(new Error('Telegram secure storage did not respond.')),
            CALL_TIMEOUT_MS
        )

        try {
            operation((error, value) => finish(error, value))
        } catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)))
        }
    })

const requireStorage = (): SecureStorageApi => {
    const storage = secureStorage()
    if (!storage) {
        throw new Error('Telegram secure storage is not available in this browser.')
    }
    return storage
}

const getItem = async (key: string) => {
    const storage = requireStorage()
    const value = await call<string | null>(callback =>
        storage.getItem(key, (error, result) => callback(error, result ?? null))
    )
    return value ?? null
}

const setItem = async (key: string, value: string) => {
    const storage = requireStorage()
    const stored = await call<boolean>(callback => storage.setItem(key, value, callback))
    if (stored === false) {
        throw new Error(`Telegram secure storage rejected ${key}.`)
    }
}

const removeItem = async (key: string) => {
    const storage = requireStorage()
    await call<boolean>(callback => storage.removeItem(key, callback))
}

const exportKey = (key: CryptoKey) =>
    crypto.subtle.exportKey('raw', key).then(raw => encode(new Uint8Array(raw)))

const importKey = (encoded: string) =>
    crypto.subtle.importKey(
        'raw',
        decode(encoded),
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
    )

const parseVault = (serialized: string): TelegramVault => {
    const vault = JSON.parse(serialized) as Partial<TelegramVault>
    if (vault.version !== 3 || typeof vault.iv !== 'string' || typeof vault.ciphertext !== 'string') {
        throw new Error('The encrypted Telegram wallet data is invalid.')
    }
    return vault as TelegramVault
}

const decryptVault = async (serialized: string): Promise<string> => {
    const encodedKey = await getItem(ENCRYPTION_KEY)
    if (!encodedKey) {
        throw new Error('The wallet encryption key is missing from Telegram secure storage. Restore with your recovery phrase.')
    }

    const vault = parseVault(serialized)
    const cryptoKey = await importKey(encodedKey)
    const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: decode(vault.iv) },
        cryptoKey,
        decode(vault.ciphertext)
    )
    return new TextDecoder().decode(plaintext)
}

const readVault = async (key: string): Promise<string | null> => {
    const serialized = await getItem(key)
    return serialized ? decryptVault(serialized) : null
}

/**
 * Encrypts the mnemonic and stores the key, active vault, and backup in
 * Telegram SecureStorage. Mirrors `storeWallet` for passkey browsers.
 */
export const sealWalletForTelegram = async (mnemonic: string): Promise<void> => {
    requireStorage()

    const cryptoKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    )
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        new TextEncoder().encode(mnemonic)
    )
    const vault: TelegramVault = {
        version: 3,
        iv: encode(iv),
        ciphertext: encode(new Uint8Array(ciphertext))
    }
    const serialized = JSON.stringify(vault)

    // Store the key first so an interrupted write can never leave a vault
    // without its key. The wallet is only considered ready once all writes
    // succeed.
    await setItem(ENCRYPTION_KEY, await exportKey(cryptoKey))
    await setItem(VAULT_KEY, serialized)
    await setItem(BACKUP_KEY, serialized)
}

export const hasTelegramVault = async () => !!(await getItem(VAULT_KEY))

export const hasTelegramVaultBackup = async () => !!(await getItem(BACKUP_KEY))

export const openTelegramVault = async () => {
    const mnemonic = await readVault(VAULT_KEY)
    if (!mnemonic) throw new Error('No wallet was found in Telegram secure storage.')
    return mnemonic
}

/** Restores the active vault from its backup and returns the mnemonic. */
export const recoverTelegramVault = async () => {
    const serialized = await getItem(BACKUP_KEY)
    if (!serialized) throw new Error('No wallet backup was found in Telegram secure storage.')
    const mnemonic = await decryptVault(serialized)
    await setItem(VAULT_KEY, serialized)
    return mnemonic
}

export const clearTelegramVault = async (options?: { deleteBackup?: boolean }) => {
    if (!isTelegramVaultAvailable()) return
    await removeItem(VAULT_KEY)
    if (options?.deleteBackup) {
        await removeItem(BACKUP_KEY)
        await removeItem(ENCRYPTION_KEY)
    }
}
