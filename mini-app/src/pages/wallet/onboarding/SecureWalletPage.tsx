import { Page } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { getSessionMnemonic, useWallet } from "@/lib/wallet/context";
import { useRef, useState } from "react";

import { useTranslation } from "react-i18next";

import { Progress } from "@/components/ui/progress";

import type { BreezSdk } from '@breeztech/breez-sdk-spark/web'
import { generateChildKey, generateTapRootAddress } from "@/helpers/crypto";
import { useNavigate } from "react-router-dom";
import { publishAndVerifyProfile } from "@/lib/nostr/profile";
import { getTelegramUsername } from "@/lib/telegram/username";
import { passkeyUnavailableReason } from "@/lib/wallet/passkey";
import {
    isTelegramVaultAvailable,
    telegramVaultMode,
    telegramVaultUnavailableReason,
    type TelegramVaultMode
} from "@/lib/wallet/telegramVault";
import { ShieldCheck } from "lucide-react";
import { haptics } from "@/lib/telegram/ui";

type LnAddressInfo = Awaited<ReturnType<BreezSdk['getLightningAddress']>>

type UsernameChoice = { username?: string; useAutomatic?: boolean }

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

export function SecureWalletPage() {
    const wallet = useWallet()
    const { t } = useTranslation();
    const navigate = useNavigate()
    const [progressValue, setProgressValue] = useState(0)
    const [progressLabel, setProgressLabel] = useState("")

    const [error, setError] = useState<string | null>(null);
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const vaultMode: TelegramVaultMode = telegramVaultMode();
    const usingTelegramVault = isTelegramVaultAvailable();
    const usingPasswordVault = vaultMode === 'password';
    const passkeyIssue = usingTelegramVault
        ? null
        : telegramVaultUnavailableReason() ?? passkeyUnavailableReason();

    // When the preferred Lightning address username is not available, the
    // flow pauses mid-registration and asks the user to pick one.
    const usernameResolverRef = useRef<((choice: UsernameChoice) => void) | null>(null)
    const [usernamePrompt, setUsernamePrompt] = useState<{
        suggestion: string;
        reason: 'taken' | 'choose';
    } | null>(null)
    const [usernameInput, setUsernameInput] = useState('')
    const [usernameError, setUsernameError] = useState<string | null>(null)

    const askForUsername = (suggestion: string, reason: 'taken' | 'choose') => {
        setUsernamePrompt({ suggestion, reason })
        setUsernameInput(suggestion)
        setUsernameError(null)
        return new Promise<UsernameChoice>(resolve => {
            usernameResolverRef.current = resolve
        })
    }

    const resolveUsername = (choice: UsernameChoice) => {
        haptics.impact()
        setUsernamePrompt(null)
        setUsernameError(null)
        const resolver = usernameResolverRef.current
        usernameResolverRef.current = null
        resolver?.(choice)
    }

    async function secureWallet() {
        let step = 'preparing'
        try {
            setError(null)
            if (usingPasswordVault) {
                if (password.length < 8 || password !== confirmPassword) {
                    haptics.error()
                    setPasswordError(t(password.length < 8 ? 'walletPassword.tooShort' : 'walletPassword.mismatch'))
                    return
                }
            }
            setPasswordError(null)
            haptics.impact()
            setProgressValue(1)
            setProgressLabel(t(
                usingPasswordVault
                    ? 'walletSecure.passwordProgress1'
                    : usingTelegramVault
                        ? 'walletSecure.telegramProgress1'
                        : 'walletSecure.progress1'
            ))
            const mnemonic = getSessionMnemonic()
            if (!mnemonic) throw new Error('Wallet recovery phrase is missing. Return to setup and try again.')

            if (!wallet.walletExists) {
                step = 'saving wallet'
                await wallet.storeWallet(mnemonic, { password })
            }
            step = 'loading wallet'
            const sdk = await wallet.loadSdk(mnemonic)
            if (!sdk) {
                throw new Error("Cannot load the Breez SDK.")
            }

            step = 'deriving address'
            const childKey = await generateChildKey(mnemonic)
            if (!childKey.publicKey) {
                throw new Error('Cannot retrieve Bitcoin public key.')
            }
            const tapRootAddress = await generateTapRootAddress(childKey.publicKey)
            if (!tapRootAddress) {
                throw new Error('Cannot retrieve Bitcoin address.')
            }

            setProgressValue(33)
            setProgressLabel(t('walletSecure.progress33'))

            setProgressLabel(t('walletSecure.progress66'))
            setProgressValue(66)
            step = 'registering Lightning address'
            const lnInfo = await registerLightningAddress(sdk, tapRootAddress)
            if (!lnInfo?.lightningAddress || !lnInfo.lnurl?.url) {
                throw new Error(t('walletSecure.noLightningAddressGenerated'))
            }

            step = 'retrieving Bitcoin address'
            const btcAddress = await wallet.getBtcAddress(sdk)
            if (!btcAddress) {
                throw new Error('Cannot retrieve Bitcoin address.')
            }

            step = 'publishing profile'
            await publishAndVerifyProfile(mnemonic, sdk, btcAddress)

            setProgressValue(100)
            setProgressLabel(t('walletSecure.progress100'))
            haptics.success()
        }
        catch (e) {
            console.error(`Failed while ${step}:`, e)
            haptics.error()
            const message = e instanceof Error ? e.message : String(e)
            setError(`Failed while ${step}: ${message}`)
            setProgressValue(0)
            setProgressLabel("")
        }
    }

    // Registers the Lightning address with the Telegram username when
    // possible. If it is not available (or there is no Telegram username),
    // the flow pauses and lets the user choose a username before falling
    // back to the deterministic taproot address.
    async function registerLightningAddress(sdk: BreezSdk, tapRootAddress: string) {
        const register = async (username: string) => {
            const request = { username }
            if (!(await sdk.checkLightningAddressAvailable(request))) return null
            return await sdk.registerLightningAddress(request)
        }

        const telegramUsername = getTelegramUsername()?.toLowerCase()
        let info: LnAddressInfo | null = null
        if (telegramUsername) {
            info = await register(telegramUsername)
            if (!info) {
                // The username may already belong to this wallet, e.g. when it
                // was restored on a new device.
                const existing = await sdk.getLightningAddress()
                if (existing?.lightningAddress?.split('@')[0] === telegramUsername) {
                    info = existing
                }
            }
        }

        while (!info?.lightningAddress || !info.lnurl?.url) {
            const existing = await sdk.getLightningAddress()
            if (existing?.lightningAddress && existing.lnurl?.url) {
                return existing
            }

            const suggestion = telegramUsername
                ? `${telegramUsername}${Math.floor(1000 + Math.random() * 9000)}`
                : tapRootAddress
            const choice = await askForUsername(
                suggestion,
                telegramUsername ? 'taken' : 'choose'
            )

            if (choice.useAutomatic) {
                info = await register(tapRootAddress) ?? await sdk.getLightningAddress()
                continue
            }

            const username = choice.username?.trim().toLowerCase() ?? ''
            if (!USERNAME_PATTERN.test(username)) {
                haptics.error()
                setUsernameError(t('walletSecure.usernameInvalid'))
                continue
            }
            try {
                info = await register(username)
                if (!info) {
                    haptics.error()
                    setUsernameError(t('walletSecure.usernameTaken', { username }))
                }
            } catch (e) {
                console.warn('Lightning address registration failed:', e)
                haptics.error()
                setUsernameError(t('walletSecure.usernameTaken', { username }))
            }
        }
        return info
    }

    return (
        <Page back={false}>
            <div className="mx-auto flex w-full max-w-md flex-col gap-6 py-6">
                <div className="flex flex-col items-center gap-3 text-center">
                    <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#FF942C] to-[#F97316] text-white shadow-sm">
                        <ShieldCheck className="h-8 w-8" />
                    </span>
                    <h2 className="text-2xl font-semibold">{t('walletSecure.title')}</h2>
                </div>

                {usingTelegramVault && (
                    <p className="rounded-xl bg-orange-50 p-3 text-sm text-orange-700">
                        {t(usingPasswordVault ? 'walletSecure.passwordNotice' : 'walletSecure.telegramNotice')}
                    </p>
                )}
                {passkeyIssue && (
                    <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-700">{passkeyIssue}</p>
                )}
                {error && (
                    <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>
                )}

                <div className="app-card flex flex-col gap-4 p-5">
                    {progressValue === 0 && usingPasswordVault && (
                        <div className="flex flex-col gap-3">
                            <label className="flex flex-col gap-1.5">
                                <span className="text-sm font-medium">{t('walletPassword.chooseLabel')}</span>
                                <input
                                    type="password"
                                    className="h-12 w-full rounded-xl bg-gray-50 px-3 text-base text-gray-900 outline-none focus:ring-2 focus:ring-primary/30"
                                    autoComplete="new-password"
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    value={password}
                                    onChange={event => {
                                        setPassword(event.target.value)
                                        setPasswordError(null)
                                    }}
                                    placeholder={t('walletPassword.choosePlaceholder')}
                                />
                            </label>
                            <label className="flex flex-col gap-1.5">
                                <span className="text-sm font-medium">{t('walletPassword.confirmLabel')}</span>
                                <input
                                    type="password"
                                    className="h-12 w-full rounded-xl bg-gray-50 px-3 text-base text-gray-900 outline-none focus:ring-2 focus:ring-primary/30"
                                    autoComplete="new-password"
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    value={confirmPassword}
                                    onChange={event => {
                                        setConfirmPassword(event.target.value)
                                        setPasswordError(null)
                                    }}
                                    placeholder={t('walletPassword.confirmPlaceholder')}
                                />
                            </label>
                            <p className="text-xs text-gray-500">{t('walletPassword.setupHint')}</p>
                            {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
                        </div>
                    )}
                    {progressValue === 0 && (
                        <Button type="button" className="w-full" disabled={!!passkeyIssue} onClick={() => void secureWallet()}>
                            {t(usingPasswordVault
                                ? 'walletSecure.passwordRegisterButton'
                                : usingTelegramVault
                                    ? 'walletSecure.telegramRegisterButton'
                                    : 'walletSecure.registerButton')}
                        </Button>
                    )}
                    {progressValue > 0 && (
                        <div className="flex flex-col gap-4 text-center">
                            <Progress value={progressValue} />
                            <p className="text-sm text-gray-600">{progressLabel}</p>
                        </div>
                    )}
                    {progressValue > 0 && usernamePrompt && (
                        <div className="flex flex-col gap-3 text-left">
                            <p className="text-sm font-medium">
                                {t(usernamePrompt.reason === 'taken'
                                    ? 'walletSecure.lightningAddressTaken'
                                    : 'walletSecure.lightningAddressUnavailable',
                                    { suggestion: usernamePrompt.suggestion })}
                            </p>
                            <label className="flex flex-col gap-1.5">
                                <span className="text-sm font-medium">{t('walletSecure.lightningAddressUsernameLabel')}</span>
                                <input
                                    type="text"
                                    className="h-12 w-full rounded-xl bg-gray-50 px-3 text-base text-gray-900 outline-none focus:ring-2 focus:ring-primary/30"
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    value={usernameInput}
                                    onChange={event => {
                                        setUsernameInput(event.target.value)
                                        setUsernameError(null)
                                    }}
                                    placeholder={usernamePrompt.suggestion}
                                />
                            </label>
                            <p className="text-xs text-gray-500">{t('walletSecure.lightningAddressUsernameHint')}</p>
                            {usernameError && <p className="text-sm text-red-600">{usernameError}</p>}
                            <Button type="button" className="w-full" onClick={() => resolveUsername({ username: usernameInput })}>
                                {t('walletSecure.continueButton')}
                            </Button>
                            <Button type="button" variant="outline" className="w-full" onClick={() => resolveUsername({ useAutomatic: true })}>
                                {t('walletSecure.useAutomaticAddress')}
                            </Button>
                        </div>
                    )}
                    {progressValue === 100 && (
                        <Button type="button" className="w-full" onClick={() => navigate('/app/wallet')}>
                            {t('walletSecure.goToWalletButton')}
                        </Button>
                    )}
                </div>
            </div>
        </Page>
    );
}
