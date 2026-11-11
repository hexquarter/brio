import { useWallet } from '@/lib/wallet/context';
import { shortenAddress } from '@/lib/wallet/utils';
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from 'react-i18next';
import { LuCopy } from 'react-icons/lu';
import { toast } from 'sonner';
import { Payment } from '@breeztech/breez-sdk-spark/web';
import { convertSatsToBtc, formatBtcAmount, formatFiatAmount } from '@/helpers/number';
import { fetchPrice } from '@/lib/wallet/api';
import { haptics } from '@/lib/telegram/ui';
import { cn } from '@/lib/utils';

const DetailRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-start justify-between gap-4 py-3">
        <span className="shrink-0 text-sm text-gray-400">{label}</span>
        <span className="min-w-0 text-right text-sm">{children}</span>
    </div>
)

const CopyButton = ({ value }: { value: string }) => {
    const { t } = useTranslation()

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(value)
            haptics.success()
            const toastId = toast.info(t('walletActivity.copyToast'))
            setTimeout(() => toast.dismiss(toastId), 2000)
        } catch (reason) {
            haptics.error()
            toast.error(reason instanceof Error ? reason.message : String(reason))
        }
    }

    return (
        <button
            type="button"
            onClick={() => void copy()}
            aria-label={t('walletActivity.copyToast')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition-colors active:bg-gray-100 active:text-primary"
        >
            <LuCopy className="h-4 w-4" />
        </button>
    )
}

export const WalletActivityDetailsPage : React.FC = () => {
    const {t} = useTranslation()
    const {id} = useParams()
    const { breezSdk, currency} = useWallet()

    const [payment, setPayment] = useState<undefined | Payment>(undefined)
    const [price, setPrice] = useState(0)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false

        const loadPayment = async () => {
            try {
                const [paymentResponse, price] = await Promise.all([
                    breezSdk?.getPayment({ paymentId: id as string }),
                    fetchPrice(currency).catch(() => 0)
                ])
                if (cancelled) return
                setPayment(paymentResponse?.payment)
                setPrice(price)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        void loadPayment()

        return () => { cancelled = true }
    }, [breezSdk, id, currency])

    const isSend = payment?.paymentType === 'send'
    const details = payment?.details
    const amount = payment ? convertSatsToBtc(Number(payment.amount)) : 0

    return (
        <div className="flex flex-col gap-5">
            <h2 className="text-2xl font-semibold">{t('walletActivity.title')}</h2>

            {loading && (
                <div className="app-card h-40 animate-pulse bg-white/70" />
            )}

            {!loading && !payment && (
                <div className="app-card p-6 text-center text-sm text-gray-500">
                    {t('walletActivity.notFound')}
                </div>
            )}

            {payment && (
                <>
                    <div className="app-card flex flex-col items-center gap-2 px-5 py-8 text-center">
                        <span className={cn(
                            'flex h-12 w-12 items-center justify-center rounded-full text-xl font-semibold',
                            isSend ? 'bg-orange-100 text-primary' : 'bg-green-100 text-green-700'
                        )}>
                            {isSend ? '↑' : '↓'}
                        </span>
                        <p className="mt-1 text-sm text-gray-500">
                            {isSend ? t('walletActivity.spendBtcTitle') : t('walletActivity.receiveBtcTitle')}
                        </p>
                        <p className={cn(
                            'text-3xl font-semibold tabular-nums',
                            isSend ? 'text-gray-900' : 'text-green-700'
                        )}>
                            {isSend ? '-' : '+'}{formatBtcAmount(amount)} BTC
                        </p>
                        {price > 0 && (
                            <p className="text-sm text-gray-500">
                                {isSend ? '-' : '+'}{formatFiatAmount(amount * price)} {currency}
                            </p>
                        )}
                        <Badge
                            className="mt-2"
                            variant={payment.status === 'completed' ? 'default' : payment.status === 'failed' ? 'destructive' : 'warning'}
                        >
                            {t(`walletActivity.status.${payment.status}`)}
                        </Badge>
                    </div>

                    <div className="app-card divide-y divide-black/5 px-4">
                        {details?.type === 'deposit' && (
                            <DetailRow label={t('walletActivity.transaction')}>
                                <span className="inline-flex items-center gap-1">
                                    <span className="font-mono text-xs">{shortenAddress(details.txId as string)}</span>
                                    <CopyButton value={details.txId as string} />
                                </span>
                            </DetailRow>
                        )}

                        {details?.type === 'lightning' && (
                            <>
                                <DetailRow label={t('walletActivity.publicKey')}>
                                    <span className="inline-flex items-center gap-1">
                                        <span className="font-mono text-xs">{shortenAddress(details.destinationPubkey as string)}</span>
                                        <CopyButton value={details.destinationPubkey as string} />
                                    </span>
                                </DetailRow>
                                <DetailRow label={t('walletActivity.invoice')}>
                                    <span className="inline-flex items-center gap-1">
                                        <span className="font-mono text-xs">{shortenAddress(details.invoice as string)}</span>
                                        <CopyButton value={details.invoice as string} />
                                    </span>
                                </DetailRow>
                            </>
                        )}

                        {isSend && (
                            <DetailRow label={t('fees')}>
                                <span className="tabular-nums">
                                    {formatBtcAmount(convertSatsToBtc(Number(payment.fees)))} BTC
                                    {price > 0 && (
                                        <span className="block text-xs text-gray-400">
                                            {formatFiatAmount(convertSatsToBtc(Number(payment.fees)) * price)} {currency}
                                        </span>
                                    )}
                                </span>
                            </DetailRow>
                        )}

                        <DetailRow label={t('walletActivity.date')}>
                            <span className="text-gray-700">{new Date(payment.timestamp * 1000).toLocaleString()}</span>
                        </DetailRow>
                    </div>
                </>
            )}
        </div>
    )
}
