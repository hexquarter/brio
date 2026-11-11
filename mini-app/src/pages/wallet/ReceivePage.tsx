import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsContent, TabsTrigger } from '@/components/ui/tabs';

import { LuShare2, LuCopy } from "react-icons/lu";
import QRCode from "react-qr-code";
import { useWallet } from '@/lib/wallet/context';
import { toast } from "sonner"
import { openTelegramLink } from '@telegram-apps/sdk-react';
import { fetchBotInfo } from '@/lib/wallet/api';
import { Button } from '@/components/ui/button';
import { haptics } from '@/lib/telegram/ui';
import { cn } from '@/lib/utils';

export const WalletReceivePage : React.FC = () => {
    const { t } = useTranslation()
    const { getBtcAddress, getLnUrl, breezSdk  } = useWallet()

    const [btcAddress, setBtcAddress] = useState<string | undefined>(undefined)
    const [lnURL, setLnURL] = useState<string | undefined>(undefined)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!breezSdk) {
            return
        }

        let cancelled = false

        const loadOfferAndAddress = async () => {
            try {
                const [invoice, address] = await Promise.all([
                    getLnUrl(breezSdk),
                    getBtcAddress(breezSdk)
                ])
                if (cancelled) return
                if (invoice) setLnURL(invoice)
                if (address) setBtcAddress(address)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        void loadOfferAndAddress()

        return () => { cancelled = true }
    }, [breezSdk])

    const notifyCopied = (key: string) => {
        haptics.success()
        const toastId = toast.info(t(key))
        setTimeout(() => toast.dismiss(toastId), 2000)
    }

    const copyLightningAddress = async () => {
        if (!lnURL) return
        try {
            await navigator.clipboard.writeText(lnURL)
            notifyCopied('wallet.receive.copyLnToast')
        } catch {
            haptics.error()
        }
    }

    const shareLightningAddress = async () => {
        if (!lnURL) return
        const msg = `Here my Brio's Lightning address ${lnURL}`
        const botInfo = await fetchBotInfo()
        haptics.impact()
        openTelegramLink(
            `https://t.me/share/url?url=${encodeURIComponent('https://t.me/' + botInfo.username)}&text=${encodeURIComponent(msg)}`
        )
    }

    const copyBitcoinAddress = async () => {
        if (!btcAddress) return
        try {
            await navigator.clipboard.writeText(btcAddress)
            notifyCopied('wallet.receive.copybtcToast')
        } catch {
            haptics.error()
        }
    }

    const shareBitcoinAddress = async () => {
        if (!btcAddress) return
        const msg = `Here my Brio's Bitcoin address ${btcAddress}`
        const botInfo = await fetchBotInfo()
        haptics.impact()
        openTelegramLink(
            `https://t.me/share/url?url=${encodeURIComponent('https://t.me/' + botInfo.username)}&text=${encodeURIComponent(msg)}`
        )
    }

    const addressCard = (
        value: string,
        label: string,
        onCopy: () => void,
        onShare: () => void
    ) => {
        const canShare = openTelegramLink.isAvailable()
        return (
            <div className="app-card flex flex-col items-center gap-4 p-5">
                <p className="text-sm text-gray-500">{label}</p>
                <div className="rounded-2xl border border-black/5 bg-white p-3">
                    <QRCode value={value} size={172} />
                </div>
                <p className="w-full break-all text-center font-mono text-xs leading-relaxed text-gray-600">
                    {value}
                </p>
                <div className={cn('w-full', canShare ? 'grid grid-cols-2 gap-3' : 'flex')}>
                    <Button variant="outline" className="w-full" onClick={onCopy}>
                        <LuCopy className="h-4 w-4" />
                        {t('wallet.receive.copy')}
                    </Button>
                    {canShare && (
                        <Button variant="outline" className="w-full" onClick={onShare}>
                            <LuShare2 className="h-4 w-4" />
                            {t('wallet.receive.share')}
                        </Button>
                    )}
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
                <h2 className="text-2xl font-semibold">{t('wallet.receiveTitle')}</h2>
                <p className="text-sm text-gray-500">{t('wallet.receive.subtitle')}</p>
            </div>

            <Tabs defaultValue="lightning" onValueChange={() => haptics.selection()}>
                <TabsList>
                    <TabsTrigger value="lightning">{t('wallet.receive.lightningTitle')}</TabsTrigger>
                    <TabsTrigger value="btc">{t('wallet.receive.btcTitle')}</TabsTrigger>
                </TabsList>

                <TabsContent value="lightning">
                    {loading && <div className="app-card h-72 animate-pulse bg-white/70" />}
                    {!loading && lnURL && addressCard(
                        lnURL,
                        t('wallet.receive.lightningOffer'),
                        () => void copyLightningAddress(),
                        () => void shareLightningAddress()
                    )}
                </TabsContent>

                <TabsContent value="btc">
                    {loading && <div className="app-card h-72 animate-pulse bg-white/70" />}
                    {!loading && btcAddress && addressCard(
                        btcAddress,
                        t('wallet.receive.btcAddress'),
                        () => void copyBitcoinAddress(),
                        () => void shareBitcoinAddress()
                    )}
                </TabsContent>
            </Tabs>
        </div>
    )
}
