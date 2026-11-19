/**
 * Password-protected wallet storage for Telegram clients without SecureStorage
 * (notably Telegram Desktop).
 *
 * Telegram documents SecureStorage as iOS Keychain / Android Keystore only.
 * Desktop clients can still persist data through DeviceStorage, but that is not
 * a secret vault. We therefore store only an encrypted vault there and derive
 * the AES-GCM key from a user password with PBKDF2. No encryption key is stored
 * locally, and the recovery phrase remains the ultimate backup.
 */

import { request, retrieveLaunchParams, supports } from '@telegram-apps/sdk-react'
import { isMockedTelegramEnv, isTelegramEnvironment } from '@/lib/telegram/env'

type StorageCallback<T> = (error: Error | string | null, value?: T) => void

type DeviceStorageApi = {
    setItem(key: string, value: string, callback?: StorageCallback<boolean>): unknown
    getItem(key: string, callback: StorageCallback<string | null>): unknown
    removeItem(key: string, callback?: StorageCallback<boolean>): unknown
}

type TelegramWindow = Window & {
    Telegram?: {
        WebApp?: {
            DeviceStorage?: DeviceStorageApi
            isVersionAtLeast?: (version: string) => boolean
        }
    }
}

type PasswordVault = {
    version: 4
    kdf: 'PBKDF2-SHA256'
    iterations: number
    salt: string
    iv: string
    ciphertext: string
}

type BridgeResult = {
    event: string
    payload?: { value?: string | null; error?: string }
}

const VAULT_KEY = 'brio_wallet_vault'
const BACKUP_KEY = 'brio_wallet_vault_backup'
const CALL_TIMEOUT_MS = 10000
const PBKDF2_ITERATIONS = 600000

const encode = (value: Uint8Array) =>
    btoa(Array.from(value, byte => String.fromCharCode(byte)).join(''))

const decode = (value: string): Uint8Array<ArrayBuffer> =>
    Uint8Array.from(atob(value), character => character.charCodeAt(0))

const telegramPlatform = () => {
    try {
        return retrieveLaunchParams().tgWebAppPlatform
    } catch {
        return null
    }
}

const isMobileTelegram = () => ['ios', 'android'].includes(telegramPlatform() ?? '')

const directStorage = (): DeviceStorageApi | null => {
    try {
        const storage = (window as TelegramWindow).Telegram?.WebApp?.DeviceStorage
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

const bridgeSupported = () => {
    try {
        const version = retrieveLaunchParams().tgWebAppVersion
        return !!version && supports('web_app_device_storage_get_key', version)
    } catch {
        return false
    }
}

const directStorageSupported = () => {
    if (!directStorage()) return false
    try {
        const webApp = (window as TelegramWindow).Telegram?.WebApp
        return webApp?.isVersionAtLeast
            ? webApp.isVersionAtLeast('9.0')
            : bridgeSupported()
    } catch {
        return false
    }
}

/** True when this Telegram client should use the password-protected fallback. */
export const isTelegramPasswordVaultAvailable = () =>
    isTelegramEnvironment()
    && !isMockedTelegramEnv()
    && !isMobileTelegram()
    && (bridgeSupported() || directStorageSupported())

const STORAGE_UNAVAILABLE =
    "This Telegram client cannot store an encrypted wallet. Update Telegram or open Brio in a browser."

const friendlyStorageError = (message: string) =>
    /unsupported/i.test(message) ? STORAGE_UNAVAILABLE : message

type LooseRequest = (
    method: string,
    events: string[],
    options: {
        params?: object
        timeout?: number
        capture?: (result: { payload?: { req_id?: string } }) => boolean
    }
) => Promise<unknown>

const send = request as unknown as LooseRequest

const newRequestId = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let id = ''
    for (let i = 0; i < 16; i += 1) {
        id += chars[Math.floor(Math.random() * chars.length)]
    }
    return id
}

const bridgeRequest = async (
    method: string,
    events: string[],
    params?: object
): Promise<BridgeResult> => {
    const reqId = newRequestId()
    let raw: Record<string, unknown>
    try {
        raw = await send(method, events, {
            params: { ...params, req_id: reqId },
            capture: ({ payload }) => payload?.req_id === reqId,
            timeout: CALL_TIMEOUT_MS
        }) as Record<string, unknown>
    } catch (error) {
        if (error instanceof Error && /timeout/i.test(error.message)) {
            throw new Error('Telegram device storage did not respond. Reopen Brio and try again.')
        }
        throw error
    }
    const result: BridgeResult = typeof raw.event === 'string'
        ? raw as unknown as BridgeResult
        : { event: 'payload', payload: raw as BridgeResult['payload'] }
    if (result.event === 'device_storage_failed' || result.payload?.error) {
        throw new Error(friendlyStorageError(result.payload?.error || 'Telegram device storage failed.'))
    }
    return result
}

const bridgeGet = async (key: string) => {
    const result = await bridgeRequest(
        'web_app_device_storage_get_key',
        ['device_storage_key_received', 'device_storage_failed'],
        { key }
    )
    return result.payload?.value ?? null
}

const bridgeSet = async (key: string, value: string | null) => {
    await bridgeRequest(
        'web_app_device_storage_save_key',
        ['device_storage_key_saved', 'device_storage_failed'],
        { key, value }
    )
}

const call = <T>(operation: (callback: StorageCallback<T>) => void): Promise<T | undefined> =>
    new Promise((resolve, reject) => {
        let settled = false
        const finish = (error: Error | string | null, value?: T) => {
            if (settled) return
            settled = true
            window.clearTimeout(timer)
            if (error) {
                const message = error instanceof Error ? error.message : error
                reject(new Error(friendlyStorageError(message)))
            } else {
                resolve(value)
            }
        }
        const timer = window.setTimeout(
            () => finish(new Error('Telegram device storage did not respond. Reopen Brio and try again.')),
            CALL_TIMEOUT_MS
        )
        try {
            operation((error, value) => finish(error, value))
        } catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)))
        }
    })

const requireTransport = () => {
    if (directStorageSupported()) return 'direct' as const
    if (bridgeSupported()) return 'bridge' as const
    throw new Error(STORAGE_UNAVAILABLE)
}

const getItem = async (key: string) => {
    const transport = requireTransport()
    if (transport === 'bridge') return bridgeGet(key)
    const storage = directStorage()!
    const value = await call<string | null>(callback =>
        storage.getItem(key, (error, result) => callback(error, result ?? null))
    )
    return value ?? null
}

const setItem = async (key: string, value: string) => {
    const transport = requireTransport()
    if (transport === 'bridge') {
        await bridgeSet(key, value)
        return
    }
    const storage = directStorage()!
    const stored = await call<boolean>(callback => storage.setItem(key, value, callback))
    if (stored === false) {
        throw new Error(`Telegram device storage rejected ${key}.`)
    }
}

const removeItem = async (key: string) => {
    const transport = requireTransport()
    if (transport === 'bridge') {
        await bridgeSet(key, null)
        return
    }
    const storage = directStorage()!
    await call<boolean>(callback => storage.removeItem(key, callback))
}

const deriveKey = async (password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) => {
    const material = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveKey']
    )
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    )
}

const parseVault = (serialized: string): PasswordVault => {
    const vault = JSON.parse(serialized) as Partial<PasswordVault>
    if (vault.version !== 4
        || vault.kdf !== 'PBKDF2-SHA256'
        || typeof vault.iterations !== 'number'
        || typeof vault.salt !== 'string'
        || typeof vault.iv !== 'string'
        || typeof vault.ciphertext !== 'string') {
        throw new Error('The encrypted wallet data is invalid.')
    }
    return vault as PasswordVault
}

const decryptVault = async (serialized: string, password: string): Promise<string> => {
    const vault = parseVault(serialized)
    const key = await deriveKey(password, decode(vault.salt), vault.iterations)
    try {
        const plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: decode(vault.iv) },
            key,
            decode(vault.ciphertext)
        )
        return new TextDecoder().decode(plaintext)
    } catch {
        throw new Error('Incorrect wallet password.')
    }
}

/** Encrypts the mnemonic with a password and stores only ciphertext. */
export const sealWalletForTelegramDesktop = async (mnemonic: string, password: string): Promise<void> => {
    requireTransport()
    if (password.length < 8) {
        throw new Error('Choose a wallet password with at least 8 characters.')
    }

    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const key = await deriveKey(password, salt, PBKDF2_ITERATIONS)
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode(mnemonic)
    )
    const vault: PasswordVault = {
        version: 4,
        kdf: 'PBKDF2-SHA256',
        iterations: PBKDF2_ITERATIONS,
        salt: encode(salt),
        iv: encode(iv),
        ciphertext: encode(new Uint8Array(ciphertext))
    }
    const serialized = JSON.stringify(vault)
    await setItem(VAULT_KEY, serialized)
    await setItem(BACKUP_KEY, serialized)
}

export const hasTelegramDesktopVault = async () => !!(await getItem(VAULT_KEY))

export const hasTelegramDesktopVaultBackup = async () => !!(await getItem(BACKUP_KEY))

export const openTelegramDesktopVault = async (password: string) => {
    const serialized = await getItem(VAULT_KEY)
    if (!serialized) throw new Error('No wallet was found in Telegram device storage.')
    return decryptVault(serialized, password)
}

export const recoverTelegramDesktopVault = async (password: string) => {
    const serialized = await getItem(BACKUP_KEY)
    if (!serialized) throw new Error('No wallet backup was found in Telegram device storage.')
    const mnemonic = await decryptVault(serialized, password)
    await setItem(VAULT_KEY, serialized)
    return mnemonic
}

export const clearTelegramDesktopVault = async (options?: { deleteBackup?: boolean }) => {
    if (!isTelegramPasswordVaultAvailable()) return
    await removeItem(VAULT_KEY)
    if (options?.deleteBackup) {
        await removeItem(BACKUP_KEY)
    }
}
