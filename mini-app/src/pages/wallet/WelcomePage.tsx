import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { deferSecureExport, hasSecureExport, isSecureExportDeferred } from '@/lib/wallet/backup';
import { haptics } from '@/lib/telegram/ui';

export const WalletWelcomePage : React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [showExportTip, setShowExportTip] = useState(
        () => !hasSecureExport() && !isSecureExportDeferred()
    );

    const go = (path: string) => {
        haptics.impact();
        navigate(path);
    }

    const defer = () => {
        haptics.selection();
        deferSecureExport();
        setShowExportTip(false);
    };

    return (
        <div className="flex flex-col gap-5 pb-2">
            <div className="flex flex-col gap-1">
                <h2 className="text-xl font-semibold">{t('main.welcomeTitle')}</h2>
                <p className="text-sm text-gray-500">{t('main.welcomeDescription')}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <button
                    type="button"
                    onClick={() => go('/app/wallet/send')}
                    className="app-card flex flex-col items-start gap-3 p-4 text-left transition-transform active:scale-[0.98]"
                >
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-orange-100 text-primary">
                        <ArrowUpRight className="h-5 w-5" />
                    </span>
                    <span className="flex flex-col gap-0.5">
                        <span className="font-medium">{t('wallet.menuSendBTC')}</span>
                        <span className="text-xs text-gray-500">{t('wallet.home.sendHint')}</span>
                    </span>
                </button>

                <button
                    type="button"
                    onClick={() => go('/app/wallet/receive')}
                    className="app-card flex flex-col items-start gap-3 p-4 text-left transition-transform active:scale-[0.98]"
                >
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-green-100 text-green-700">
                        <ArrowDownLeft className="h-5 w-5" />
                    </span>
                    <span className="flex flex-col gap-0.5">
                        <span className="font-medium">{t('wallet.menuReceiveBTC')}</span>
                        <span className="text-xs text-gray-500">{t('wallet.home.receiveHint')}</span>
                    </span>
                </button>
            </div>

            {showExportTip && (
                <div className="app-card border-amber-200 bg-amber-50 p-4">
                    <div className="flex items-start gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                            <ShieldAlert className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                            <h3 className="font-medium text-amber-900">{t('main.secureExportTitle')}</h3>
                            <p className="mt-1 text-sm text-amber-800">{t('main.secureExportDescription')}</p>
                        </div>
                    </div>
                    <div className="mt-4 flex flex-col gap-2">
                        <Button size="sm" onClick={() => go('/app/wallet/backup')}>
                            {t('main.secureExportButton')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={defer}>
                            {t('main.secureExportLater')}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}
