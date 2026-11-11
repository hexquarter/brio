
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

import { useTranslation } from "react-i18next";
import { getSessionMnemonic, useWallet } from "@/lib/wallet/context";
import { markSecureExport } from "@/lib/wallet/backup";
import { toast } from "sonner";
import { LuCopy } from "react-icons/lu";
import { ShieldAlert } from "lucide-react";
import { haptics } from "@/lib/telegram/ui";

export function BackupWalletPage() {
    const { t } = useTranslation();
    const [mnemonic, setMnemonic] = useState<string[]>([])

    const wallet = useWallet()
    
    useEffect(() => {
        const mnemonic = getSessionMnemonic()
        if (!mnemonic) {
            haptics.error()
            const toastId = toast.error('Wallet not found')
            setTimeout(() => {
                toast.dismiss(toastId)
            }, 2000)
            window.location.replace("/#/app/nowallet");
            return
        }

        setMnemonic(mnemonic.split(' '))
    }, [wallet.walletExists])

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(mnemonic.join(' '))
            markSecureExport()
            haptics.success()
            const toastId = toast.info(t('walletBackup.copyToast'))
            setTimeout(() => {
                toast.dismiss(toastId)
            }, 2000)
        } catch {
            haptics.error()
        }
    }

    const finish = () => {
        markSecureExport()
        haptics.success()
        window.location.replace('#/app/wallet')
    }

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
                <h2 className="text-2xl font-semibold">{t('walletBackup.title')}</h2>
                <p className="text-sm text-gray-500">{t('walletBackup.subtitle')}</p>
            </div>

            { mnemonic.join('').length > 0 && (
                <>
                    <div className="app-card flex flex-col gap-4 p-4">
                        <div className="grid grid-cols-3 gap-2">
                            {mnemonic.map((word, index) => (
                                <div key={index} className="flex items-center gap-1.5 rounded-xl bg-gray-50 px-2 py-2">
                                    <span className="text-[10px] tabular-nums text-gray-400">{index + 1}</span>
                                    <span className="truncate text-sm font-medium">{word}</span>
                                </div>
                            ))}
                        </div>
                        <Button variant="outline" className="w-full" onClick={() => void copy()}>
                            <LuCopy className="h-4 w-4" />
                            {t('walletBackup.copyButton')}
                        </Button>
                    </div>

                    <div className="app-card flex items-start gap-3 border-amber-200 bg-amber-50 p-4" role="alert">
                        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                        <p className="text-sm text-amber-900">{t('walletBackup.warning')}</p>
                    </div>

                    <Button className="w-full" onClick={finish}>{t('walletBackup.nextButton')}</Button>
                </>
            )}
        </div>
    );
}
