import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { t as globalT } from 'i18next';
import { nip19 } from 'nostr-tools';
import { toast } from 'sonner';
import { Copy, Download, Link2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getSessionMnemonic, useWallet } from '@/lib/wallet/context';
import {
  fetchOwnNostrProfile,
  importNostrProfile,
  linkExistingNostrProfile,
  publishAndVerifyProfile,
  resolveNostrPublicKeyInput,
  type OwnNostrProfile
} from '@/lib/nostr/profile';
import { fetchNostrProfile, getNostrConfig } from '@/lib/nostr/client';
import {
  clearFoundProfile,
  clearProfileOverrides,
  getFoundProfile,
  setDismissedProfileEventId,
  type FoundProfile
} from '@/lib/wallet/session';
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
  const [found, setFound] = useState<FoundProfile | null>(null)

  // Connect-an-existing-profile flow (npub link, read-only).
  const [connectOpen, setConnectOpen] = useState(false)
  const [linkInput, setLinkInput] = useState('')
  const [preview, setPreview] = useState<{
    npub: string;
    fetched: NonNullable<OwnNostrProfile['fetched']>;
  } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [linking, setLinking] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setFound(getFoundProfile())
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

  // Shared setup for all actions that republish the profile.
  const requireWalletContext = async () => {
    const mnemonic = getSessionMnemonic()
    if (!mnemonic || !wallet.breezSdk) {
      throw new Error(t('wallet.settings.nostr.walletUnavailable'))
    }
    const btcAddress = await wallet.getBtcAddress(wallet.breezSdk)
    if (!btcAddress) throw new Error('Cannot retrieve Bitcoin address.')
    return { mnemonic, sdk: wallet.breezSdk, btcAddress }
  }

  const importProfile = async () => {
    haptics.impact()
    if (!wallet.breezSdk) {
      toast.error(t('wallet.settings.nostr.walletUnavailable'))
      return
    }
    setImporting(true)
    try {
      const { mnemonic, sdk, btcAddress } = await requireWalletContext()
      const result = await importNostrProfile(mnemonic, sdk, btcAddress)
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

  // "Start fresh": ignore the found profile and publish the defaults.
  const startFresh = async () => {
    haptics.impact()
    try {
      const { mnemonic, sdk, btcAddress } = await requireWalletContext()
      if (found) setDismissedProfileEventId(found.eventId)
      clearProfileOverrides()
      clearFoundProfile()
      await publishAndVerifyProfile(mnemonic, sdk, btcAddress)
      haptics.success()
      toast.success(t('wallet.settings.nostr.freshSuccess'))
      await load()
    } catch (e) {
      console.warn('Unable to publish a fresh profile:', e)
      haptics.error()
      toast.error(t('wallet.settings.nostr.importFailed', {
        reason: e instanceof Error ? e.message : String(e)
      }))
    }
  }

  const fetchPreview = async () => {
    haptics.impact()
    setPreviewLoading(true)
    setConnectError(null)
    setPreview(null)
    try {
      const publicKey = resolveNostrPublicKeyInput(linkInput)
      if (!publicKey) throw new Error(t('wallet.settings.nostr.connectInvalidKey'))
      const fetched = await fetchNostrProfile(publicKey)
      if (!fetched) throw new Error(t('wallet.settings.nostr.connectNotFound'))
      setPreview({ npub: nip19.npubEncode(publicKey), fetched })
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : String(e))
    } finally {
      setPreviewLoading(false)
    }
  }

  const linkProfile = async () => {
    if (!preview || linking) return
    haptics.impact()
    setLinking(true)
    setConnectError(null)
    try {
      const { mnemonic, sdk, btcAddress } = await requireWalletContext()
      await linkExistingNostrProfile(mnemonic, sdk, btcAddress, linkInput)
      haptics.success()
      toast.success(t('wallet.settings.nostr.linkSuccess'))
      setConnectOpen(false)
      setPreview(null)
      setLinkInput('')
      await load()
    } catch (e) {
      console.warn('Unable to link the Nostr profile:', e)
      haptics.error()
      setConnectError(t('wallet.settings.nostr.linkFailed', {
        reason: e instanceof Error ? e.message : String(e)
      }))
    } finally {
      setLinking(false)
    }
  }

  const profile = data?.fetched?.profile

  return (
    <div className="flex flex-col gap-1 py-2">
      {found && !loading && (
        <div className="rounded-xl bg-amber-50 p-3 text-left">
          <p className="text-sm font-medium text-amber-900">{t('wallet.settings.nostr.foundTitle')}</p>
          <p className="mt-1 text-xs text-amber-700">{t('wallet.settings.nostr.foundDescription')}</p>
          <div className="mt-3 flex flex-row gap-2">
            <Button type="button" size="sm" className="flex-1" disabled={importing} onClick={() => void importProfile()}>
              {importing ? t('wallet.settings.nostr.importing') : t('wallet.settings.nostr.importIt')}
            </Button>
            <Button type="button" variant="outline" size="sm" className="flex-1" disabled={importing} onClick={() => void startFresh()}>
              {t('wallet.settings.nostr.startFresh')}
            </Button>
          </div>
        </div>
      )}

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
          <Row label={t('wallet.settings.nostr.nip05')} value={profile.nip05} />
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

      {connectOpen ? (
        <div className="mt-1 flex flex-col gap-2 rounded-xl bg-gray-50 p-3 text-left">
          <p className="text-sm font-medium">{t('wallet.settings.nostr.connectTitle')}</p>
          <p className="text-xs text-gray-500">{t('wallet.settings.nostr.connectDescription')}</p>
          <input
            type="text"
            className="h-11 w-full rounded-xl bg-white px-3 font-mono text-sm text-gray-900 outline-none focus:ring-2 focus:ring-primary/30"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={linkInput}
            onChange={event => {
              setLinkInput(event.target.value)
              setConnectError(null)
            }}
            placeholder="npub1…"
          />
          {preview && (
            <div className="rounded-xl border border-black/5 bg-white p-3">
              <Row label={t('wallet.settings.nostr.publicKey')} value={preview.npub} mono />
              <Row label={t('wallet.settings.nostr.name')} value={preview.fetched.profile.name} />
              <Row label={t('wallet.settings.nostr.displayName')} value={preview.fetched.profile.display_name} />
              <Row label={t('wallet.settings.nostr.about')} value={preview.fetched.profile.about} />
            </div>
          )}
          {connectError && <p className="text-xs text-red-600">{connectError}</p>}
          {preview ? (
            <div className="flex flex-row gap-2">
              <Button type="button" size="sm" className="flex-1" disabled={linking} onClick={() => void linkProfile()}>
                <Link2 className="h-4 w-4" />
                {linking ? t('wallet.settings.nostr.linking') : t('wallet.settings.nostr.connectLink')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1"
                disabled={linking}
                onClick={() => {
                  haptics.selection()
                  setPreview(null)
                  setConnectError(null)
                }}
              >
                {t('wallet.settings.nostr.connectCancel')}
              </Button>
            </div>
          ) : (
            <Button type="button" size="sm" disabled={previewLoading} onClick={() => void fetchPreview()}>
              {previewLoading ? t('wallet.settings.nostr.connectFetching') : t('wallet.settings.nostr.connectFetch')}
            </Button>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="mt-1 flex items-center justify-center gap-1.5 py-2 text-xs text-gray-500 underline-offset-2 hover:underline"
          onClick={() => {
            haptics.selection()
            setConnectOpen(true)
            setLinkInput('')
            setPreview(null)
            setConnectError(null)
          }}
        >
          <Link2 className="h-3.5 w-3.5" />
          {t('wallet.settings.nostr.connectProfile')}
        </button>
      )}
    </div>
  )
}
