import { WalletBalance } from '@/components/wallet/WalletBalance';
import { WalletNav } from '@/components/wallet/WalletNav';

import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Page } from '@/components/Page';
import { useWallet } from '@/lib/wallet/context';

import { useEffect, useState } from 'react';
import { convertSatsToBtc } from '@/helpers/number';
import { BreezSdk } from '@breeztech/breez-sdk-spark/web';
import { fetchPrice } from '@/lib/wallet/api';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { haptics } from '@/lib/telegram/ui';

export const WalletMainPage = () => {
    const { t } = useTranslation()
    const { breezSdk, currency } = useWallet()
    const navigate = useNavigate()
    const location = useLocation()
    const [searchParams, setSearchParams] = useSearchParams()
    const [btcBalance, setBtcBalance] = useState(0)
    const [fiatBalance, setFiatBalance] = useState(0)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState("")
    const [price, setPrice] = useState(0)

    const isHome = location.pathname === '/app/wallet'
    const isTab = isHome
        || location.pathname === '/app/wallet/activity'
        || location.pathname === '/app/wallet/settings'
    const isActivityDetail = /^\/app\/wallet\/activity\/[^/]+$/.test(location.pathname)
    const hideNav = isActivityDetail || location.pathname.includes('/backup')

    useEffect(() => {
        const paymentId = searchParams.get('payment')
        if (!breezSdk || !paymentId) return

        void breezSdk.listPayments({}).then(({ payments }) => {
            const payment = payments.find(item => {
                if (item.paymentType !== 'receive') return false
                if (item.id === paymentId) return true
                const details = item.details
                const paymentHash = details && (details.type === 'lightning' || details.type === 'spark')
                    ? details.htlcDetails?.paymentHash
                    : undefined
                return paymentHash === paymentId
            })
            if (payment) {
                navigate(`/app/wallet/activity/${payment.id}`, { replace: true })
            } else {
                toast.error(t('wallet.paymentNotFound'))
            }
            setSearchParams({}, { replace: true })
        }).catch(error => {
            console.error('Unable to find payment:', error)
            toast.error(t('wallet.paymentLoadFailed'))
        })
    }, [breezSdk, navigate, searchParams, setSearchParams, t])

    // Prices change slowly. Poll every minute and pause while the mini app is
    // backgrounded instead of hammering the API every few seconds.
    useEffect(() => {
        let cancelled = false

        const refreshPrice = async () => {
            try {
                const nextPrice = await fetchPrice(currency)
                if (!cancelled && nextPrice > 0) setPrice(nextPrice)
            } catch (reason) {
                console.warn('Unable to refresh the price:', reason)
            }
        }

        void refreshPrice()

        const interval = setInterval(() => {
            if (document.visibilityState === 'visible') void refreshPrice()
        }, 60000)
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') void refreshPrice()
        }
        document.addEventListener('visibilitychange', onVisibilityChange)

        return () => {
            cancelled = true
            clearInterval(interval)
            document.removeEventListener('visibilitychange', onVisibilityChange)
        }
    }, [currency])

    useEffect(() => {
        if (!breezSdk) return

        let cancelled = false

        const loadBalance = async (breezSdk: BreezSdk, ensureSync: boolean = false) => {
            try {
                const walletInfo = await breezSdk.getInfo({ ensureSynced: ensureSync })
                if (cancelled) return
                const btc = convertSatsToBtc(walletInfo.balanceSats)
                setBtcBalance(btc)
                setFiatBalance(btc * price)
                setError("")
            } catch (reason) {
                if (!cancelled) setError((reason as Error).message)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        void loadBalance(breezSdk)

        // A lightweight refresh is enough for a wallet screen. The SDK emits
        // payment events for immediate updates; this is only a safety net.
        const interval = setInterval(() => {
            if (document.visibilityState === 'visible') void loadBalance(breezSdk, true)
        }, 15000)
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') void loadBalance(breezSdk, true)
        }
        document.addEventListener('visibilitychange', onVisibilityChange)

        return () => {
            cancelled = true
            clearInterval(interval)
            document.removeEventListener('visibilitychange', onVisibilityChange)
        }
    }, [breezSdk, price])

    const reload = () => {
        haptics.impact()
        window.location.reload()
    }

    const errorCard = error ? (
        <div className="app-card border-red-100 bg-red-50 p-4">
            <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
                <div className="min-w-0 flex-1">
                    <p className="font-medium text-red-700">{t('wallet.errorTitle')}</p>
                    <p className="mt-1 text-sm text-red-600">{t('wallet.errorDescription')}</p>
                    <p className="mt-2 break-words text-xs text-red-500">{error}</p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={reload}>
                        <RefreshCw className="h-4 w-4" />
                        {t('common.retry')}
                    </Button>
                </div>
            </div>
        </div>
    ) : null

    return (
        <Page back={!isTab}>
            <div className="app-shell mx-auto flex w-full max-w-md flex-col">
                <main className={cn('flex-1 px-4 pt-4', hideNav ? 'pb-8' : 'pb-28')}>
                    {isHome && loading && (
                        <div className="app-card h-36 animate-pulse bg-white/70" />
                    )}
                    {isHome && !loading && !error && (
                        <WalletBalance
                            btcBalance={btcBalance}
                            fiatBalance={fiatBalance}
                            currency={currency}
                        />
                    )}
                    {!isHome && error && errorCard}
                    <div className={cn(isHome && 'mt-5')}>
                        {isHome && error && errorCard}
                        <Outlet context={[btcBalance]} />
                    </div>
                </main>
                {!hideNav && <WalletNav />}
            </div>
        </Page>
    );
};
