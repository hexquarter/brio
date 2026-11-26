import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { t as globalT } from 'i18next';
import { toast } from 'sonner';
import { Copy, Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getSessionMnemonic, useWallet } from '@/lib/wallet/context';
import { fetchOwnNostrProfile, importNostrProfile, type OwnNostrProfile } from '@/lib/nostr/profile';
import { getNostrConfig } from '@/lib/nostr/client';
import { haptics } from '@/lib/telegram/ui';
import { cn } from '@/lib/utils';

const copyValue = async (value: string) => {
    await navigator.clipboard.writeText(value)
    toast.success(globalT('walletActivity.copyToast'))
}

const Row = ({ label, value, mono }: { label: string; value?: string; mono?: boolean }) => {
    if (!value) return null
    return (
        <div className="flex items-center justify-between gap-3 py-2">
            <span className="text-xs text-gray-400">{label}</span>
            <button
                type="button"
                className="flex min-w-0 items-center gap-1.5 text-right"
                onClick={() => void copyValue(value)}
            >
                <span className={cn('truncate text-sm text-gray-900', mono && 'font-mono text-xs')}>
                    {value}
                </span>
                <Copy className="h-3 w-3 shrink-0 text-gray-300" />
            </button>
        </div>
    )
}

export const NostrProfilePanel = () => {
    const { t } = useTranslation()
    const wallet = useWallet()
    const [data, setData] = useState<OwnNostrProfile | null>(null)
    const [relays, setRelays] = useState<string[] | null>(null)
    const [loading, setLoading] = useState(false)
    const [importing, setImporting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const mnemonic = getSessionMnemonic()
            if (!mnemonic) throw new Error('Wallet recovery phrase is not available.')
            const own = await fetchOwnNostrProfile(mnemonic)
            setData(own)
            const config = await getNostrConfig()
            setRelays(config.relays)
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void load()
    }, [load])

    const importProfile = async () => {
        haptics.impact()
        const mnemonic = getSessionMnemonic()
        if (!mnemonic || !wallet.breezSdk) {
            toast.error(t('wallet.settings.nostr.walletUnavailable'))
            return
        }
        setImporting(true)
        try {
            const btcAddress = await wallet.getBtcAddress(wallet.breezSdk)
            if (!btcAddress) throw new Error('Cannot retrieve Bitcoin address.')
            const result = await importNostrProfile(mnemonic, wallet.breezSdk, btcAddress)
            if (result.event) {
                haptics.success()
                toast.success(t('wallet.settings.nostr.importSuccess'))
            } else {
                toast.info(t('wallet.settings.nostr.importSkipped'))
            }
            await load()
        } catch (e) {
            console.warn('Unable to import the Nostr profile:', e)
            haptics.error()
            toast.error(t('wallet.settings.nostr.importFailed', {
                reason: e instanceof Error ? e.message : String(e)
            }))
        } finally {
            setImporting(false)
        }
    }

    const profile = data?.fetched?.profile

    return (
        <div className="flex flex-col gap-1 py-2">
            <div className="flex items-center justify-between gap-3 py-2">
                <span className="text-xs text-gray-400">{t('wallet.settings.nostr.publicKey')}</span>
                <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-mono text-xs text-gray-900">
                        {data?.npub ?? '…'}
                    </span>
                    {data?.npub && (
                        <button type="button" onClick={() => void copyValue(data.npub)}>
                            <Copy className="h-3 w-3 shrink-0 text-gray-300" />
                        </button>
                    )}
                </div>
            </div>

            {loading && <p className="py-2 text-sm text-gray-500">{t('wallet.settings.nostr.loading')}</p>}

            {!loading && error && (
                <p className="rounded-lg bg-red-50 p-2 text-xs text-red-600">{error}</p>
            )}

            {!loading && !error && !profile && (
                <p className="py-2 text-sm text-gray-500">{t('wallet.settings.nostr.notFound')}</p>
            )}

            {!loading && profile && (
                <>
                    <Row label={t('wallet.settings.nostr.name')} value={profile.name} />
                    <Row label={t('wallet.settings.nostr.displayName')} value={profile.display_name} />
                    <Row label={t('wallet.settings.nostr.about')} value={profile.about} />
                    <Row label={t('wallet.settings.nostr.lightningAddress')} value={profile.lightningAddress ?? profile.lud16} />
                    <Row label={t('wallet.settings.nostr.lnurl')} value={profile.lnurl} mono />
                    <Row label={t('wallet.settings.nostr.btcAddress')} value={profile.btcAddress} mono />
                    <div className="flex items-center justify-between gap-3 py-2">
                        <span className="text-xs text-gray-400">{t('wallet.settings.nostr.updated')}</span>
                        <span className="text-sm text-gray-900">
                            {new Date((data?.fetched?.createdAt ?? 0) * 1000).toLocaleString()}
                        </span>
                    </div>
                </>
            )}

            {relays && relays.length > 0 && (
                <div className="flex items-start justify-between gap-3 py-2">
                    <span className="text-xs text-gray-400">{t('wallet.settings.nostr.relays')}</span>
                    <span className="max-w-[70%] whitespace-pre-line text-right font-mono text-[10px] leading-4 text-gray-500">
                        {relays.map(relay => relay.replace(/^wss:\/\//, '')).join('\n')}
                    </span>
                </div>
            )}

            <div className="mt-2 flex flex-row gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    disabled={loading}
                    onClick={() => {
                        haptics.impact()
                        void load()
                    }}
                >
                    <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                    {t('wallet.settings.nostr.refresh')}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    className="flex-1"
                    disabled={importing || loading}
                    onClick={() => void importProfile()}
                >
                    <Download className="h-4 w-4" />
                    {importing ? t('wallet.settings.nostr.importing') : t('wallet.settings.nostr.import')}
                </Button>
            </div>
        </div>
    )
}
