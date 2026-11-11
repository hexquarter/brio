import { Page } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { getSessionMnemonic, useWallet } from "@/lib/wallet/context";
import { useState } from "react";

import { useTranslation } from "react-i18next";

import { Progress } from "@/components/ui/progress";

import { generateChildKey, generateTapRootAddress } from "@/helpers/crypto";
import { useNavigate } from "react-router-dom";
import { publishAndVerifyProfile } from "@/lib/nostr/profile";
import { passkeyUnavailableReason } from "@/lib/wallet/passkey";
import { ShieldCheck } from "lucide-react";
import { haptics } from "@/lib/telegram/ui";

export function SecureWalletPage() {
    const wallet = useWallet()
    const { t } = useTranslation();
    const navigate = useNavigate()
    const [progressValue, setProgressValue] = useState(0)
    const [progressLabel, setProgressLabel] = useState("")

    const [error, setError] = useState<string | null>(null);
    const passkeyIssue = passkeyUnavailableReason();

    async function secureWallet() {
        try {
            setError(null)
            haptics.impact()
            setProgressValue(1)
            setProgressLabel(t('walletSecure.progress1'))
            const mnemonic = getSessionMnemonic()
            if (!mnemonic) throw new Error('Wallet recovery phrase is missing. Return to setup and try again.')

            if (!wallet.walletExists) {
                await wallet.storeWallet(mnemonic)
            }
            const sdk = await wallet.loadSdk(mnemonic)
            if (!sdk) {
                throw new Error("Cannot load the Breez SDK.")
            }

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
            const registerLightningAddressRequest = { username: tapRootAddress }
            const available = await sdk.checkLightningAddressAvailable(registerLightningAddressRequest)
            const info = available
                ? await sdk.registerLightningAddress(registerLightningAddressRequest)
                : await sdk.getLightningAddress()
            if (!info?.lightningAddress || !info.lnurl?.url) {
                throw new Error(t('walletSecure.noLightningAddressGenerated'))
            }

            const btcAddress = await wallet.getBtcAddress(sdk)
            if (!btcAddress) {
                throw new Error('Cannot retrieve Bitcoin address.')
            }

            await publishAndVerifyProfile(mnemonic, sdk, btcAddress)

            setProgressValue(100)
            setProgressLabel(t('walletSecure.progress100'))
            haptics.success()
        }
        catch (e) {
            console.error(e)
            haptics.error()
            setError(e instanceof Error ? e.message : String(e))
            setProgressValue(0)
            setProgressLabel("")
        }
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

                {passkeyIssue && (
                    <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-700">{passkeyIssue}</p>
                )}
                {error && (
                    <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>
                )}

                <div className="app-card flex flex-col gap-4 p-5">
                    {progressValue === 0 && (
                        <Button type="button" className="w-full" disabled={!!passkeyIssue} onClick={() => void secureWallet()}>
                            {t('walletSecure.registerButton')}
                        </Button>
                    )}
                    {progressValue > 0 && (
                        <div className="flex flex-col gap-4 text-center">
                            <Progress value={progressValue} />
                            <p className="text-sm text-gray-600">{progressLabel}</p>
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
