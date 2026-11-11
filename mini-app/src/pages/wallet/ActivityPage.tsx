import { convertSatsToBtc, formatBtcAmount, formatFiatAmount } from '@/helpers/number';
import { fetchPrice } from '@/lib/wallet/api';
import { useWallet } from '@/lib/wallet/context';
import { Payment } from '@breeztech/breez-sdk-spark';
import { ArrowDownLeft, ArrowUpRight, Clock3 } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { formatDistanceToNow } from "date-fns";
import { enUS, fr, es, zhCN, hi } from "date-fns/locale";
import i18n from "../../i18n";
import { haptics } from '@/lib/telegram/ui';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const locales = {
  en: enUS,
  fr,
  es,
  zh: zhCN,
  hi,
} as const;

type LocaleKey = keyof typeof locales;

const timeAgo = (timestamp: number) => {
  const lang = (i18n.language.split("-")[0] as LocaleKey) || "en"
  const locale = locales[lang] ?? enUS

  return formatDistanceToNow(timestamp, {
    addSuffix: true,
    locale,
  })
}

export type FormattedPayment = {
        fiatAmount: string
        btcAmount: string
        btcFee: string
        fiatFee: string
    } & Payment

export const WalletActivityPage : React.FC = () => {
    const { t } = useTranslation()
    const { breezSdk, currency} = useWallet()
    const navigate = useNavigate()
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [payments, setPayments] = useState<FormattedPayment[]>([])
    const [visibleCount, setVisibleCount] = useState(20)

    useEffect(() => {
        if (!breezSdk) return

        let cancelled = false

        const loadPayments = async () => {
            try {
                const price = await fetchPrice(currency).catch(() => 0)
                const response = await breezSdk.listPayments({ limit: 100 })
                if (cancelled) return
                setPayments(response.payments.map((payment: Payment) => {
                    const rawBtcAmount = convertSatsToBtc(Number(payment.amount))
                    const feeBtcAmount = convertSatsToBtc(Number(payment.fees))
                    const formattedPayment = payment as FormattedPayment
                    formattedPayment.fiatAmount = formatFiatAmount(rawBtcAmount * price)
                    formattedPayment.btcAmount = formatBtcAmount(rawBtcAmount)
                    formattedPayment.fiatFee = formatFiatAmount(feeBtcAmount * price)
                    formattedPayment.btcFee = formatBtcAmount(feeBtcAmount)
                    return formattedPayment
                }))
                setError(null)
            } catch (reason) {
                if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        void loadPayments()

        // Payment events update the list immediately. This slower poll is only a
        // safety net, and it pauses while the mini app is in the background.
        const interval = setInterval(() => {
            if (document.visibilityState === 'visible') void loadPayments()
        }, 15000)
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') void loadPayments()
        }
        document.addEventListener('visibilitychange', onVisibilityChange)

        return () => {
            cancelled = true
            clearInterval(interval)
            document.removeEventListener('visibilitychange', onVisibilityChange)
        }
    }, [breezSdk, currency])

    const openPayment = (id: string) => {
        haptics.impact()
        navigate(id)
    }

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
                <h2 className="text-2xl font-semibold">{t('walletActivities.title')}</h2>
                <p className="text-sm text-gray-500">{t('walletActivities.subtitle')}</p>
            </div>

            {loading && (
                <div className="app-card divide-y divide-black/5">
                    {[0, 1, 2].map(index => (
                        <div key={index} className="flex items-center gap-3 p-4">
                            <div className="h-10 w-10 animate-pulse rounded-full bg-gray-100" />
                            <div className="flex-1 space-y-2">
                                <div className="h-3 w-24 animate-pulse rounded bg-gray-100" />
                                <div className="h-3 w-32 animate-pulse rounded bg-gray-100" />
                            </div>
                            <div className="h-3 w-16 animate-pulse rounded bg-gray-100" />
                        </div>
                    ))}
                </div>
            )}

            {!loading && error && (
                <div className="app-card border-red-100 bg-red-50 p-4 text-sm text-red-600">
                    <p className="font-medium">{t('walletActivities.loadFailed')}</p>
                    <p className="mt-1 break-words text-xs text-red-500">{error}</p>
                </div>
            )}

            {!loading && !error && payments.length === 0 && (
                <div className="app-card flex flex-col items-center gap-3 px-6 py-12 text-center">
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-gray-400">
                        <Clock3 className="h-6 w-6" />
                    </span>
                    <div className="flex flex-col gap-1">
                        <p className="font-medium">{t('walletActivities.empty')}</p>
                        <p className="text-sm text-gray-500">{t('walletActivities.emptyDescription')}</p>
                    </div>
                </div>
            )}

            {!loading && !error && payments.length > 0 && (
                <div className="flex flex-col gap-3">
                    <div className="app-card divide-y divide-black/5 overflow-hidden">
                        {payments.slice(0, visibleCount).map((payment: FormattedPayment) => {
                        const isReceive = payment.paymentType === 'receive'
                        const isPending = payment.status === 'pending'
                        const isFailed = payment.status === 'failed'
                        return (
                            <button
                                key={payment.id}
                                type="button"
                                onClick={() => openPayment(payment.id)}
                                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-gray-50"
                            >
                                <span className={cn(
                                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                                    isReceive ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-primary'
                                )}>
                                    {isReceive
                                        ? <ArrowDownLeft className="h-5 w-5" />
                                        : <ArrowUpRight className="h-5 w-5" />}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block font-medium">
                                        {isReceive ? t('walletActivity.received') : t('walletActivity.sent')}
                                    </span>
                                    <span className="block truncate text-xs text-gray-400">
                                        {payment.fiatAmount} {currency} · {timeAgo(payment.timestamp * 1000)}
                                    </span>
                                </span>
                                <span className="flex flex-col items-end gap-1">
                                    <span className={cn(
                                        'text-sm font-medium tabular-nums',
                                        isReceive ? 'text-green-700' : 'text-gray-900'
                                    )}>
                                        {isReceive ? '+' : '-'}{payment.btcAmount} BTC
                                    </span>
                                    {isPending && (
                                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                            {t('walletActivity.status.pending')}
                                        </span>
                                    )}
                                    {isFailed && (
                                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-600">
                                            {t('walletActivity.status.failed')}
                                        </span>
                                    )}
                                </span>
                            </button>
                        )
                    })}
                    </div>
                    {payments.length > visibleCount && (
                        <Button
                            variant="outline"
                            className="w-full"
                            onClick={() => {
                                haptics.selection()
                                setVisibleCount(count => count + 20)
                            }}
                        >
                            {t('walletActivities.showMore')}
                        </Button>
                    )}
                </div>
            )}
        </div>
    )
}
