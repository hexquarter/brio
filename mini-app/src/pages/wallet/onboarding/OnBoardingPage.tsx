import { Page } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { Spinner } from "@telegram-apps/telegram-ui";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@/lib/wallet/context";
import { Fingerprint, KeyRound, ShieldCheck } from "lucide-react";
import { haptics } from "@/lib/telegram/ui";

export function OnBoardingPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const wallet = useWallet();

    const [hasPasskeyBackup, setHasPasskeyBackup] = useState(false);
    const [recovering, setRecovering] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false
        void wallet.hasPasskeyBackup()
            .then(available => {
                if (!cancelled) setHasPasskeyBackup(available)
            })
            .catch(reason => {
                console.warn('Failed to look for a passkey backup:', reason)
            })
        return () => { cancelled = true }
    }, [])

    const recoverWithPasskey = async () => {
        setError(null)
        setRecovering(true)
        haptics.impact()
        try {
            await wallet.recoverWalletWithPasskey()
            haptics.success()
            navigate('/app/wallet', { replace: true })
        } catch (reason) {
            haptics.error()
            setError(reason instanceof Error ? reason.message : String(reason))
            setRecovering(false)
        }
    }

    const go = (path: string) => {
        haptics.impact()
        navigate(path)
    }

    return (
        <Page back={false}>
            <div className="app-shell mx-auto flex w-full max-w-md flex-col justify-center gap-6 px-1 py-6">
                <div className="flex flex-col items-center gap-3 text-center">
                    <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#FF942C] to-[#F97316] text-white shadow-sm">
                        <ShieldCheck className="h-8 w-8" />
                    </span>
                    <h1 className="text-2xl font-semibold">{t('main.nowalletTitle')}</h1>
                    <p className="text-sm text-gray-500">{t('main.nowalletDescription_1')}</p>
                </div>

                <div className="app-card divide-y divide-black/5">
                    <div className="flex items-start gap-3 p-4">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-100 text-primary">
                            <Fingerprint className="h-4 w-4" />
                        </span>
                        <p className="text-sm text-gray-600">{t('main.nowalletDescription_2')}</p>
                    </div>
                    <div className="flex items-start gap-3 p-4">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
                            <KeyRound className="h-4 w-4" />
                        </span>
                        <p className="text-sm text-gray-600">{t('main.nowalletDescription_3')}</p>
                    </div>
                </div>

                {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}

                <div className="flex flex-col gap-3">
                    <Button className="w-full" onClick={() => go('/app/nowallet/create-wallet')}>
                        {t('walletSetup.createButton')}
                    </Button>
                    <Button variant="secondary" className="w-full" onClick={() => go('/app/nowallet/restore-wallet')}>
                        {t('walletSetup.restoreButton')}
                    </Button>
                    {hasPasskeyBackup && (
                        <Button
                            variant="outline"
                            className="w-full"
                            disabled={recovering}
                            onClick={() => void recoverWithPasskey()}
                        >
                            {recovering && <Spinner size="s" />}
                            {recovering ? t('walletSetup.passkeyRecovering') : t('walletSetup.passkeyRecoverButton')}
                        </Button>
                    )}
                </div>
            </div>
        </Page>
    );
}
