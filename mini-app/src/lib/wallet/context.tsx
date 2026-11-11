
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
import { openWallet, sealWallet } from '@/lib/wallet/passkey';
import { clearSecureExport } from '@/lib/wallet/backup';
import { clearContacts } from '@/lib/wallet/contact';
import { clearNostrIdentity } from '@/lib/nostr/identity';
import { publishAndVerifyProfile } from '@/lib/nostr/profile';
import {
    clearProfileSynced,
    clearSessionMnemonic,
    getSessionMnemonic,
    isProfileSynced,
    storeSessionMnemonic
} from '@/lib/wallet/session';

export { getSessionMnemonic, storeSessionMnemonic } from '@/lib/wallet/session';

export type WalletContextType = {
    walletExists: boolean;
    loadSdk: (mnemonic: string) => Promise<BreezSdk | null>
    unlockWallet: () => Promise<void>
    storeWallet: (mnemonic: string) => Promise<void>
    hasPasskeyBackup: () => Promise<boolean>
    recoverWalletWithPasskey: () => Promise<void>
    breezSdk: BreezSdk | undefined;
    getLnUrl: (breezSdk: BreezSdk) => Promise<string | null>
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
    const [currency, setCurrency] = useState(sessionStorage.getItem(WALLET_CURRENCY)?.toUpperCase() || 'USD')

    const rememberVaultBackup = (vault: string) => {
        localStorage.setItem(WALLET_BACKUP_KEY, vault)
    }

    const readVaultBackup = () => localStorage.getItem(WALLET_BACKUP_KEY)

    const checkWallet = async () => {
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

    const hasPasskeyBackup = async () => !!readVaultBackup()

    const recoverWalletWithPasskey = async () => {
        const vault = readVaultBackup()
        if (!vault) {
            throw new Error('No passkey backup was found on this device.')
        }

        const mnemonic = await openWallet(vault)
        localStorage.setItem(WALLET_KEY, vault)
        storeSessionMnemonic(mnemonic)
        setWalletExists(true)
        const sdk = await loadSdk(mnemonic)
        if (sdk) void syncProfile(mnemonic, sdk)
    }

    const unlockWallet = async () => {
        const existingMnemonic = getSessionMnemonic()
        if (breezSdk && existingMnemonic) {
            void syncProfile(existingMnemonic, breezSdk)
            return
        }

        const vault = localStorage.getItem(WALLET_KEY)
        const legacyWallet = sessionStorage.getItem(LEGACY_WALLET_KEY)
        const mnemonic = vault ? await openWallet(vault) : legacyWallet
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
        sessionStorage.setItem(WALLET_CURRENCY, value)
        setCurrency(value)
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

    const storeWallet = async (mnemonic: string) => {
        const vault = await sealWallet(mnemonic)
        localStorage.setItem(WALLET_KEY, vault)
        sessionStorage.removeItem(LEGACY_WALLET_KEY)
        sessionStorage.removeItem(WALLET_LN_URL)
        sessionStorage.removeItem(WALLET_BTC_ADDRESS)
        clearProfileSynced()
        clearContacts()
        clearSecureExport()
        rememberVaultBackup(vault)
        storeSessionMnemonic(mnemonic)
        setLnUrl(null)
        setBtcAddress(null)
        setWalletExists(true)
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

        const info = await breezSdk?.getLightningAddress()
        if (info) {
            setLnUrl(info.lnurl.url)
            sessionStorage.setItem(WALLET_LN_URL, info.lnurl.url)
            return info.lnurl.url
        }
        return null
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
            const address = await getBtcAddress(sdk)
            if (!address) {
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
