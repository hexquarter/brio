import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCopy, LuShare2, LuRefreshCw } from 'react-icons/lu'
import QRCode from 'react-qr-code'
import { Button } from '@/components/ui/button'
import { Spinner } from '@telegram-apps/telegram-ui'
import { useWallet, getSessionMnemonic } from '@/lib/wallet/context'
import { toast } from 'sonner'
import { openTelegramLink } from '@telegram-apps/sdk-react'
import { fetchBotInfo } from '@/lib/wallet/api'
import { buildNostrAddress, fetchNpubcashInfo, fetchNpubcashQuotes, type NpubcashQuote } from '@/lib/wallet/npubcash'
import { claimNpubcashQuote, pocketSats, sweepPocketIntoSpark } from '@/lib/wallet/cashu'
import { haptics } from '@/lib/telegram/ui'
import { cn } from '@/lib/utils'
import { formatBtcAmount, convertSatsToBtc } from '@/helpers/number'

type ClaimProgress = { id: string; message: string } | null

export const NostrReceive = () => {
    const { t } = useTranslation()
    const { breezSdk } = useWallet()
    const mnemonic = getSessionMnemonic()

    const [address, setAddress] = useState<string | null>(null)
    const [addressError, setAddressError] = useState<string | null>(null)
    const [quotes, setQuotes] = useState<NpubcashQuote[] | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [progress, setProgress] = useState<ClaimProgress>(null)
    const [claimError, setClaimError] = useState<string | null>(null)
    const [pocket, setPocket] = useState(0)
    const [mintUrl, setMintUrl] = useState<string | null>(null)

    const loadQuotes = useCallback(async () => {
        if (!mnemonic) return
        setLoading(true)
        setLoadError(null)
        try {
            const result = await fetchNpubcashQuotes(mnemonic)
            setQuotes(result)
        } catch (error) {
            console.error('Unable to load Nostr payments:', error)
            setLoadError(t('walletNostr.loadFailed'))
        } finally {
            setLoading(false)
        }
    }, [mnemonic, t])

    useEffect(() => {
        if (!mnemonic) return
        let cancelled = false
        void buildNostrAddress(mnemonic)
            .then(value => { if (!cancelled) setAddress(value) })
            .catch(error => {
                console.error('Unable to build the Nostr address:', error)
                if (!cancelled) setAddressError((error as Error).message)
            })
        void loadQuotes()
        setPocket(pocketSats())
        void fetchNpubcashInfo().then(info => { if (!cancelled && info) setMintUrl(info.mint) })
        return () => { cancelled = true }
    }, [mnemonic, loadQuotes])

    const notifyCopied = (key: string) => {
        haptics.success()
        const toastId = toast.info(t(key))
        setTimeout(() => toast.dismiss(toastId), 2000)
    }

    const copyAddress = async () => {
        if (!address) return
        try {
            await navigator.clipboard.writeText(address)
            notifyCopied('walletNostr.copyToast')
        } catch {
            haptics.error()
        }
    }

    const shareAddress = async () => {
        if (!address) return
        haptics.impact()
        const botInfo = await fetchBotInfo().catch(() => undefined)
        const text = `Send me Bitcoin on Nostr: ${address}`
        if (openTelegramLink.isAvailable() && botInfo?.username) {
            openTelegramLink(
                `https://t.me/share/url?url=${encodeURIComponent(`https://t.me/${botInfo.username}`)}&text=${encodeURIComponent(text)}`
            )
        } else {
            await navigator.clipboard.writeText(text).catch(() => undefined)
            toast.info(text)
        }
    }

    const claim = async (quote: NpubcashQuote) => {
        if (!breezSdk) return
        setClaimError(null)
        setProgress({ id: quote.quote, message: t('walletNostr.claiming') })
        haptics.impact()
        try {
            const summary = await claimNpubcashQuote(breezSdk, quote)
            haptics.success()
            setProgress(null)
            setPocket(pocketSats())
            void loadQuotes()
            toast.success(t('walletNostr.claimSuccess', {
                sats: formatBtcAmount(convertSatsToBtc(summary.claimedSats))
            }))
        } catch (error) {
            console.error('Claim failed:', error)
            haptics.error()
            setProgress(null)
            setPocket(pocketSats())
            setClaimError((error as Error).message)
        }
    }

    const sweep = async () => {
        if (!breezSdk || !pocket) return
        setClaimError(null)
        setProgress({ id: 'pocket', message: t('walletNostr.claiming') })
        haptics.impact()
        try {
            await sweepPocketIntoSpark(breezSdk)
            haptics.success()
            setProgress(null)
            setPocket(pocketSats())
        } catch (error) {
            console.error('Sweep failed:', error)
            haptics.error()
            setProgress(null)
            setClaimError((error as Error).message)
        }
    }

    if (!mnemonic) return null

    const pending = quotes?.filter(quote => quote.state === 'INFLIGHT' || quote.state === 'UNPAID') ?? []
    const claimable = quotes?.filter(quote => quote.state === 'PAID') ?? []
    const claimed = quotes?.filter(quote => quote.state === 'ISSUED') ?? []

    return (
        <div className="flex flex-col items-center gap-4">
            {address && (
                <div className="app-card flex w-full flex-col items-center gap-4 p-5">
                    <p className="text-sm text-gray-500">{t('walletNostr.addressTitle')}</p>
                    <div className="rounded-2xl border border-black/5 bg-white p-3">
                        <QRCode value={address} size={172} />
                    </div>
                    <p className="w-full break-all text-center font-mono text-xs leading-relaxed text-gray-600">
                        {address}
                    </p>
                    <p className="text-xs text-gray-400">{t('walletNostr.addressDescription')}</p>
                    <div className={cn('w-full grid', openTelegramLink.isAvailable() ? 'grid-cols-2 gap-3' : 'grid-cols-1')}>
                        <Button variant="outline" className="w-full" onClick={() => void copyAddress()}>
                            <LuCopy className="h-4 w-4" />
                            {t('wallet.receive.copy')}
                        </Button>
                        {openTelegramLink.isAvailable() && (
                            <Button variant="outline" className="w-full" onClick={() => void shareAddress()}>
                                <LuShare2 className="h-4 w-4" />
                                {t('wallet.receive.share')}
                            </Button>
                        )}
                    </div>
                </div>
            )}
            {addressError && (
                <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{addressError}</p>
            )}

            <div className="app-card w-full flex flex-col gap-3 p-4">
                <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{t('walletNostr.pendingTitle')}</p>
                    <button
                        type="button"
                        className="flex items-center gap-1 text-xs text-gray-400"
                        onClick={() => { haptics.selection(); void loadQuotes() }}
                    >
                        {loading && <Spinner size="s" />}
                        <LuRefreshCw className="h-3.5 w-3.5" />
                        {t('walletNostr.refresh')}
                    </button>
                </div>

                {loadError && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{loadError}</p>}

                {quotes && !claimable.length && !pending.length && !claimed.length && (
                    <p className="text-sm text-gray-400">{t('walletNostr.empty')}</p>
                )}

                {claimable.map(quote => {
                    const busy = progress?.id === quote.quote
                    return (
                        <div key={quote.quote} className="flex flex-col gap-2 rounded-xl bg-gray-50 p-3">
                            <div className="flex items-center justify-between text-sm">
                                <span className="font-semibold tabular-nums">
                                    {formatBtcAmount(convertSatsToBtc(quote.amountSats))} BTC
                                </span>
                                {quote.zap && <span className="text-xs text-orange-500">⚡ zap</span>}
                            </div>
                            {busy ? (
                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                    <Spinner size="s" />
                                    <span>{progress?.message}</span>
                                </div>
                            ) : (
                                <Button
                                    type="button"
                                    className="w-full"
                                    disabled={progress !== null}
                                    onClick={() => void claim(quote)}
                                >
                                    {t('walletNostr.claimButton')}
                                </Button>
                            )}
                        </div>
                    )
                })}

                {pending.map(quote => (
                    <div key={quote.quote} className="flex items-center justify-between rounded-xl bg-gray-50 p-3 text-sm">
                        <span className="font-semibold tabular-nums">
                            {formatBtcAmount(convertSatsToBtc(quote.amountSats))} BTC
                        </span>
                        <span className="text-xs text-gray-400">{t('walletNostr.state.inflight')}</span>
                    </div>
                ))}

                {claimed.map(quote => (
                    <div key={quote.quote} className="flex items-center justify-between rounded-xl bg-gray-50 p-3 text-sm">
                        <span className="tabular-nums text-gray-500">
                            {formatBtcAmount(convertSatsToBtc(quote.amountSats))} BTC
                        </span>
                        <span className="text-xs text-green-600">{t('walletNostr.state.claimed')}</span>
                    </div>
                ))}

                {pocket > 0 && (
                    <div className="flex flex-col gap-2 rounded-xl bg-amber-50 p-3">
                        <p className="text-xs text-amber-700">{t('walletNostr.pocketNote')}</p>
                        <Button
                            type="button"
                            variant="outline"
                            className="w-full"
                            disabled={progress !== null}
                            onClick={() => void sweep()}
                        >
                            {t('walletNostr.sweepButton')}
                        </Button>
                    </div>
                )}

                {claimError && (
                    <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{claimError}</p>
                )}

                <p className="text-xs text-gray-400">
                    {t('walletNostr.mintNote', { mint: mintUrl ? new URL(mintUrl).hostname : '' })}
                </p>
            </div>
        </div>
    )
}
