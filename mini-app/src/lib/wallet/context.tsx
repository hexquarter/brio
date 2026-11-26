
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

import {
    BreezSdk,
    connect,
    defaultConfig,
    LogEntry,
    SdkEvent,
    initLogging,
    Seed
} from '@breeztech/breez-sdk-spark/web'
import { toast } from 'sonner';
import { t } from 'i18next';
import { isSupportedCurrency } from '@/lib/wallet/api';
import { openWallet, sealWallet } from '@/lib/wallet/passkey';
import {
    clearTelegramVault,
    hasTelegramVault,
    hasTelegramVaultBackup,
    openTelegramVault,
    recoverTelegramVault,
    sealWalletForTelegram,
    telegramVaultMode
} from '@/lib/wallet/telegramVault';
import {
    clearTelegramDesktopVault,
    hasTelegramDesktopVault,
    hasTelegramDesktopVaultBackup,
    openTelegramDesktopVault,
    recoverTelegramDesktopVault,
    sealWalletForTelegramDesktop
} from '@/lib/wallet/telegramDesktopVault';
import { clearSecureExport } from '@/lib/wallet/backup';
import { clearContacts } from '@/lib/wallet/contact';
import { clearNostrIdentity } from '@/lib/nostr/identity';
import { publishAndVerifyProfile, detectExistingNostrProfile } from '@/lib/nostr/profile';
import { getTelegramUsername } from '@/lib/telegram/username';
import {
    clearProfileOverrides,
    clearProfileSynced,
    clearSessionMnemonic,
    getSessionMnemonic,
    isProfileSynced,
    storeSessionMnemonic
} from '@/lib/wallet/session';
import {
    clearDismissedProfileEventId,
    clearFoundProfile,
    setFoundProfile
} from '@/lib/wallet/session';

export { getSessionMnemonic, storeSessionMnemonic } from '@/lib/wallet/session';

export type LightningAddressClaimResult = 'registered' | 'taken' | 'invalid' | 'failed'

// Allowed username for a Lightning address (user@domain).
export const LIGHTNING_USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

export type WalletContextType = {
    walletExists: boolean;
    loadSdk: (mnemonic: string) => Promise<BreezSdk | null>
    unlockWallet: (options?: { password?: string }) => Promise<void>
    storeWallet: (mnemonic: string, options?: { password?: string }) => Promise<void>
    hasPasskeyBackup: () => Promise<boolean>
    recoverWalletWithPasskey: (options?: { password?: string }) => Promise<void>
    breezSdk: BreezSdk | undefined;
    getLnUrl: (breezSdk: BreezSdk) => Promise<string | null>
    claimLightningAddress: (username: string) => Promise<LightningAddressClaimResult>
    getBtcAddress: (breezSdk: BreezSdk) => Promise<string | null>,
    currency: string,
    changeCurrency: (currency: string) => void,
    resetWallet: (options?: { deleteBackup?: boolean }) => Promise<void>
    checkWallet: () => Promise<boolean>
};

const WalletContext = createContext<WalletContextType | undefined>(undefined);

const WALLET_KEY = 'wallet_vault'
const WALLET_BACKUP_KEY = 'wallet_vault_backup'
const LEGACY_WALLET_KEY = 'wallet'
const WALLET_LN_URL = 'wallet_ln_url'
const WALLET_BTC_ADDRESS = 'wallet_btc_address'
const WALLET_CURRENCY = 'wallet_currency'

const notifications = new Set<string>()

class JsEventListener {
    onEvent = async (event: SdkEvent) => {
        switch(event.type) {
            case "paymentSucceeded": 
            console.log(event)
                if (event.payment.status == 'pending') {
                    if (notifications.has(event.payment.id)) {
                        return
                    }
                    if (event.payment.paymentType == 'receive' && event.payment.status == 'pending') {
                        toast.success(t('wallet.receivePaymentPending'))
                    }
                    notifications.add(event.payment.id)
                }
                if (event.payment.paymentType == 'send' && event.payment.status == 'completed') {
                    toast.success(t('wallet.sendPaymentSucceeded'))
                }
                break
            case "paymentFailed":
                toast.error(t('wallet.paymentFailed'))
                break
            default:
                console.log('event', event)
        }
    }
}

class WebLogger {
  log = (l: LogEntry) => {
    console.log(`[${l.level}]: ${l.line}`)
  }
}

let logger: WebLogger | null = null;

export const WalletProvider = ({children}: {children: ReactNode}) => {
    const [walletExists, setWalletExists] = useState(!!localStorage.getItem(WALLET_KEY) || !!sessionStorage.getItem(LEGACY_WALLET_KEY));
    const [breezSdk, setBreezSdk] = useState<BreezSdk | undefined>(undefined);
    const [lnUrl, setLnUrl] = useState<string | null>(null)
    const [btcAddress, setBtcAddress] = useState<string | null>(null)
    const [currency, setCurrency] = useState(() => {
        const stored = sessionStorage.getItem(WALLET_CURRENCY)?.toUpperCase()
        return stored && isSupportedCurrency(stored) ? stored : 'USD'
    })

    const rememberVaultBackup = (vault: string) => {
        localStorage.setItem(WALLET_BACKUP_KEY, vault)
    }

    const readVaultBackup = () => localStorage.getItem(WALLET_BACKUP_KEY)

    const checkWallet = async () => {
        // Telegram's WebView cannot use WebAuthn. Mobile uses native
        // SecureStorage; other Telegram clients use the password vault.
        const vaultMode = telegramVaultMode()
        if (vaultMode === 'secure' && await hasTelegramVault()) {
            setWalletExists(true)
            return true
        }
        if (vaultMode === 'password' && await hasTelegramDesktopVault()) {
            setWalletExists(true)
            return true
        }

        const vault = localStorage.getItem(WALLET_KEY)
        if (!vault) {
            const legacyWallet = sessionStorage.getItem(LEGACY_WALLET_KEY)
            setWalletExists(!!legacyWallet)
            return !!legacyWallet
        }

        // Wallets created before passkey recovery existed only have the active
        // vault. Keep a copy so a reset can still be undone with the passkey.
        if (!localStorage.getItem(WALLET_BACKUP_KEY)) {
            rememberVaultBackup(vault)
        }

        setWalletExists(true)
        return true
    }

    const hasPasskeyBackup = async () => {
        const vaultMode = telegramVaultMode()
        if (vaultMode === 'secure') return hasTelegramVaultBackup()
        if (vaultMode === 'password') return hasTelegramDesktopVaultBackup()
        return !!readVaultBackup()
    }

    const recoverWalletWithPasskey = async (options?: { password?: string }) => {
        let mnemonic: string

        const vaultMode = telegramVaultMode()
        if (vaultMode === 'secure') {
            mnemonic = await recoverTelegramVault()
        } else if (vaultMode === 'password') {
            if (!options?.password) {
                throw new Error('Enter your wallet password to recover this wallet.')
            }
            mnemonic = await recoverTelegramDesktopVault(options.password)
        } else {
            const vault = readVaultBackup()
            if (!vault) {
                throw new Error('No wallet backup was found on this device.')
            }
            mnemonic = await openWallet(vault)
            localStorage.setItem(WALLET_KEY, vault)
        }

        storeSessionMnemonic(mnemonic)
        setWalletExists(true)
        const sdk = await loadSdk(mnemonic)
        if (sdk) void syncProfile(mnemonic, sdk)
    }

    const unlockWallet = async (options?: { password?: string }) => {
        const existingMnemonic = getSessionMnemonic()
        if (breezSdk && existingMnemonic) {
            void syncProfile(existingMnemonic, breezSdk)
            return
        }

        let mnemonic: string | null
        const vaultMode = telegramVaultMode()
        if (vaultMode === 'secure' && await hasTelegramVault()) {
            mnemonic = await openTelegramVault()
        } else if (vaultMode === 'password' && await hasTelegramDesktopVault()) {
            if (!options?.password) {
                throw new Error('Enter your wallet password to unlock.')
            }
            mnemonic = await openTelegramDesktopVault(options.password)
        } else {
            const vault = localStorage.getItem(WALLET_KEY)
            const legacyWallet = sessionStorage.getItem(LEGACY_WALLET_KEY)
            mnemonic = vault ? await openWallet(vault) : legacyWallet
        }
        if (!mnemonic) throw new Error('No wallet is available to unlock.')
        storeSessionMnemonic(mnemonic)
        const sdk = await loadSdk(mnemonic)
        if (sdk) void syncProfile(mnemonic, sdk)
    }

    useEffect(() => {
        window.addEventListener("storage", checkWallet);
        return () => window.removeEventListener("storage", checkWallet);
    }, [])

    const resetWallet = async (options?: { deleteBackup?: boolean }) => {
        await clearTelegramVault(options)
        await clearTelegramDesktopVault(options)
        localStorage.removeItem(WALLET_KEY)
        sessionStorage.removeItem(LEGACY_WALLET_KEY)
        sessionStorage.removeItem(WALLET_LN_URL)
        sessionStorage.removeItem(WALLET_BTC_ADDRESS)
        sessionStorage.removeItem(WALLET_CURRENCY)
        if (options?.deleteBackup) {
            localStorage.removeItem(WALLET_BACKUP_KEY)
            clearSecureExport()
        }
        clearProfileSynced()
        clearProfileOverrides()
        clearFoundProfile()
        clearDismissedProfileEventId()
        clearContacts()
        clearSessionMnemonic()
        clearNostrIdentity()

        try {
            await breezSdk?.disconnect()
        } catch (error) {
            console.warn('Failed to disconnect the Breez SDK:', error)
        }
        setBreezSdk(undefined)
        setLnUrl(null)
        setBtcAddress(null)
        setCurrency('USD')
        setWalletExists(false)
    }

    const changeCurrency = async (value: string) => {
        const next = value.toUpperCase()
        if (!isSupportedCurrency(next)) return
        sessionStorage.setItem(WALLET_CURRENCY, next)
        setCurrency(next)
    }

    const loadSdk = async (mnemonic: string) => {
        // If already initialized, just return the existing SDK
        let sdk = breezSdk
        if (!sdk) {
            sdk = await initBreezSdk(mnemonic)
            setBreezSdk(sdk)
        }

        return sdk
    }

    const storeWallet = async (mnemonic: string, options?: { password?: string }) => {
        const vaultMode = telegramVaultMode()
        if (vaultMode === 'secure') {
            await sealWalletForTelegram(mnemonic)
        } else if (vaultMode === 'password') {
            if (!options?.password) {
                throw new Error('Choose a wallet password to secure this wallet.')
            }
            await sealWalletForTelegramDesktop(mnemonic, options.password)
        } else {
            const vault = await sealWallet(mnemonic)
            localStorage.setItem(WALLET_KEY, vault)
            rememberVaultBackup(vault)
        }
        sessionStorage.removeItem(LEGACY_WALLET_KEY)
        sessionStorage.removeItem(WALLET_LN_URL)
        sessionStorage.removeItem(WALLET_BTC_ADDRESS)
        clearProfileSynced()
        clearProfileOverrides()
        clearFoundProfile()
        clearDismissedProfileEventId()
        clearContacts()
        clearSecureExport()
        storeSessionMnemonic(mnemonic)
        setLnUrl(null)
        setBtcAddress(null)
        setWalletExists(true)
    }

    // Wallets created before Lightning address registration (or restored
    // without the onboarding step) may not have one yet. Claim the Telegram
    // username so the address is easy to share, and migrate legacy wallets
    // whose username is the derived taproot address.
    const resolveLightningAddress = async (breezSdk: BreezSdk) => {
        // The SDK can take a moment to load a previously registered address
        // after connecting. Avoid replacing it with a new one too eagerly.
        let current = await breezSdk.getLightningAddress()
        for (let attempt = 0; !current?.lnurl?.url && attempt < 2; attempt++) {
            await new Promise<void>(resolve => setTimeout(resolve, 300))
            current = await breezSdk.getLightningAddress()
        }

        const telegramUsername = getTelegramUsername()?.toLowerCase()
        const currentUsername = current?.lightningAddress?.split('@')[0]

        // Legacy wallets registered their taproot address as the username.
        // Migrate them to the Telegram username when it is claimable.
        if (current?.lnurl?.url && telegramUsername && currentUsername && currentUsername.startsWith('bc1p')) {
            try {
                const request = { username: telegramUsername }
                if (await breezSdk.checkLightningAddressAvailable(request)) {
                    const migrated = await breezSdk.registerLightningAddress(request)
                    if (migrated?.lightningAddress) {
                        return migrated
                    }
                }
            } catch (error) {
                console.warn('Unable to migrate the Lightning address to the Telegram username:', error)
            }
            return current
        }

        if (current?.lnurl?.url) {
            return current
        }

        if (!telegramUsername) {
            return current ?? null
        }

        // Try to claim the Telegram username. If it is taken — possibly by
        // this same wallet on another device — the existing address is
        // returned below.
        try {
            const request = { username: telegramUsername }
            if (await breezSdk.checkLightningAddressAvailable(request)) {
                return await breezSdk.registerLightningAddress(request)
            }
        } catch (error) {
            console.warn('Unable to register the Telegram Lightning address:', error)
        }

        return (await breezSdk.getLightningAddress()) ?? current ?? null
    }

    const getLnUrl = async (breezSdk: BreezSdk) => {
        if (lnUrl) {
            return lnUrl
        }
        if (!breezSdk) {
            return  null
        }

        const cachedLnUrl = sessionStorage.getItem(WALLET_LN_URL)
        if (cachedLnUrl) {
            return cachedLnUrl
        }

        const info = await resolveLightningAddress(breezSdk)
        // Prefer the human-readable Lightning address (user@domain) over the
        // LNURL-pay endpoint URL, which is not user-friendly to share.
        const address = info?.lightningAddress ?? info?.lnurl?.url
        if (address) {
            setLnUrl(address)
            sessionStorage.setItem(WALLET_LN_URL, address)
            return address
        }
        return null
    }

    // Claims a Lightning address username on demand (Receive page
    // customization). Updates the cached address and re-publishes the Nostr
    // profile so the new address becomes discoverable.
    const claimLightningAddress = async (username: string): Promise<LightningAddressClaimResult> => {
        if (!breezSdk) {
            return 'failed'
        }

        const target = username.trim().toLowerCase()
        if (!LIGHTNING_USERNAME_PATTERN.test(target)) {
            return 'invalid'
        }

        try {
            const request = { username: target }
            if (!(await breezSdk.checkLightningAddressAvailable(request))) {
                // The username may already belong to this wallet, e.g. when it
                // was claimed on another device.
                const existing = await breezSdk.getLightningAddress()
                if (existing?.lightningAddress?.split('@')[0] === target) {
                    rememberLightningAddress(existing)
                    return 'registered'
                }
                return 'taken'
            }

            await breezSdk.registerLightningAddress(request)

            // The SDK can take a moment to expose the freshly registered address.
            let info = await breezSdk.getLightningAddress()
            for (let attempt = 0; !info?.lightningAddress && attempt < 3; attempt++) {
                await new Promise<void>(resolve => setTimeout(resolve, 300))
                info = await breezSdk.getLightningAddress()
            }
            if (!info?.lightningAddress) {
                return 'failed'
            }
            rememberLightningAddress(info)

            // Best-effort: make the new address discoverable again.
            const mnemonic = getSessionMnemonic()
            if (mnemonic) {
                try {
                    const btcAddress = await getBtcAddress(breezSdk)
                    if (btcAddress) {
                        await publishAndVerifyProfile(mnemonic, breezSdk, btcAddress)
                    }
                } catch (error) {
                    console.warn('Unable to re-publish the Nostr profile:', error)
                }
            }
            return 'registered'
        } catch (error) {
            console.warn('Unable to claim the Lightning address:', error)
            return 'failed'
        }
    }

    const rememberLightningAddress = (info: NonNullable<Awaited<ReturnType<BreezSdk['getLightningAddress']>>>) => {
        const address = info.lightningAddress ?? info.lnurl?.url
        if (!address) return
        setLnUrl(address)
        sessionStorage.setItem(WALLET_LN_URL, address)
    }

    const getBtcAddress = async (breezSdk: BreezSdk) => {
        if (btcAddress) {
            return btcAddress
        }
        if (!breezSdk) {
            console.log('no breek sdk')
            return  null
        }
        const cacheBtcAddress = sessionStorage.getItem(WALLET_BTC_ADDRESS)
        if (cacheBtcAddress) {
            return cacheBtcAddress
        }
        console.log('no from cache')
        const address = await fetchBtcAddress(breezSdk)
        if (address) {
            setBtcAddress(address)
            sessionStorage.setItem(WALLET_BTC_ADDRESS, address)
            return address
        }
        console.log('not from breez sdk')
        return null
    }

    const syncProfile = async (mnemonic: string, sdk: BreezSdk) => {
        if (isProfileSynced()) {
            return
        }

        try {
            // Make sure the profile can publish its Lightning address, even
            // for wallets that predate registration during onboarding.
            await resolveLightningAddress(sdk)
            const address = await getBtcAddress(sdk)
            if (!address) {
                return
            }
            // Friendly linking: if the derived key already has a profile with
            // different identity fields (e.g. after a restore), surface the
            // choice in Settings instead of silently overwriting it.
            const existing = await detectExistingNostrProfile(mnemonic)
            if (existing) {
                setFoundProfile(existing)
                return
            }
            await publishAndVerifyProfile(mnemonic, sdk, address)
        } catch (e) {
            // Profile sync is best-effort and must never block wallet unlock.
            console.warn('Failed to sync Nostr profile:', e)
        }
    }

    return (
        <WalletContext.Provider
            value={{
                loadSdk,
                unlockWallet,
                resetWallet,
                currency,
                changeCurrency,
                walletExists,
                storeWallet,
                hasPasskeyBackup,
                recoverWalletWithPasskey,
                breezSdk,
                getLnUrl,
                claimLightningAddress,
                getBtcAddress,
                checkWallet
            }}
        >
            {children}
        </WalletContext.Provider>
    );
};

const initBreezSdk = async (mnemonic: string) => {
     if (!logger) {
      logger = new WebLogger();
      await initLogging(logger);
    }

    try {
        const breezApiKey = import.meta.env.VITE_BREEZ_API_KEY
        let config = defaultConfig('mainnet')
        config.apiKey = breezApiKey
        // config.lnurlDomain = 'dev_brio.com'
    
        const seed: Seed = { type: 'mnemonic', mnemonic}
        
        const sdk = await connect({ config, seed, storageDir: "brio" })
        console.log('Wallet initialized successfully');
    
        await sdk.addEventListener(new JsEventListener())
        return sdk
    }
    catch (e) {
        console.error('Failed to initialize wallet:', e);
        throw e;
    }
}

export const fetchBtcAddress = async (sdk: BreezSdk) => {
    const res = await sdk.receivePayment({
        paymentMethod: { type: 'bitcoinAddress' }
    })

    if (res) {
        return res.paymentRequest
    }
    return null
}

export const useWallet = () => {
    const context = useContext(WalletContext);
    if (!context) throw new Error('useWallet must be used within a WalletProvider');
    return context;
};
