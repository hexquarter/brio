import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiEye, FiEyeOff } from 'react-icons/fi';
import { haptics } from '@/lib/telegram/ui';

interface WalletBalanceProps {
    btcBalance: number
    fiatBalance: number,
    currency: string
}

export const WalletBalance: React.FC<WalletBalanceProps> = ({ btcBalance, fiatBalance, currency }) => {
    const { t } = useTranslation();
    const [visibleBalance, setVisibleBalance] = useState(true)

    const toggleVisibility = () => {
        haptics.impact()
        setVisibleBalance(value => !value)
    }

    const fiat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(fiatBalance)
    const btc = new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 }).format(btcBalance)

    return (
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#FF942C] to-[#F97316] p-5 text-white shadow-sm">
            <div className="absolute -right-10 -top-12 h-36 w-36 rounded-full bg-white/10" />
            <div className="absolute -bottom-16 -left-8 h-40 w-40 rounded-full bg-black/5" />

            <div className="relative flex items-center justify-between">
                <span className="text-sm font-medium text-white/80">{t('wallet.totalBalance')}</span>
                <button
                    type="button"
                    onClick={toggleVisibility}
                    aria-label={visibleBalance ? t('wallet.hideBalance') : t('wallet.showBalance')}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white transition-colors active:bg-white/25"
                >
                    {visibleBalance ? <FiEye className="h-4 w-4" /> : <FiEyeOff className="h-4 w-4" />}
                </button>
            </div>

            <div className="relative mt-4 flex items-baseline gap-2">
                <span className="text-4xl font-semibold tabular-nums tracking-tight">
                    {visibleBalance ? fiat : '••••'}
                </span>
                <span className="text-lg font-medium text-white/80">{currency}</span>
            </div>
            <div className="relative mt-1 text-sm tabular-nums text-white/80">
                {visibleBalance ? `${btc} BTC` : '•••• BTC'}
            </div>
        </div>
    )
};
