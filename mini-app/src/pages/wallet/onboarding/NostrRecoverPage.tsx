import { Page } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { Spinner } from "@telegram-apps/telegram-ui";
import { useTranslation } from "react-i18next";
import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { storeSessionMnemonic } from "@/lib/wallet/context";
import { haptics } from "@/lib/telegram/ui";
import {
    npubFromMnemonicEntropy,
    recoverWalletFromBunker,
    recoverWalletFromNsec,
    type NostrRecovery
} from "@/lib/nostr/recover";
import { AtSign, Link2 } from "lucide-react";

type Mode = 'nsec' | 'bunker'

export function NostrRecoverPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();

    const [mode, setMode] = useState<Mode>('nsec');
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<NostrRecovery | null>(null);

    const recover = async (e: FormEvent) => {
        e.preventDefault()
        setError(null)
        setBusy(true)
        haptics.impact()
        try {
            const recovery = mode === 'nsec'
                ? recoverWalletFromNsec(input)
                : await recoverWalletFromBunker(input)
            if (!recovery) {
                haptics.error()
                setError(t('walletNostrRecover.invalidNsec'))
                return
            }
            haptics.success()
            setResult(recovery)
        } catch (reason) {
            haptics.error()
            setError(reason instanceof Error ? reason.message : String(reason))
        } finally {
            setBusy(false)
        }
    }

    const continueToWallet = () => {
        if (!result) return
        haptics.impact()
        storeSessionMnemonic(result.mnemonic, 'nostr')
        navigate('/app/nowallet/secure-wallet')
    }

    return (
        <Page back={true}>
            <form className="mx-auto flex w-full max-w-md flex-col gap-6 py-2" onSubmit={recover}>
                <div className="flex flex-col gap-2">
                    <h2 className="text-2xl font-semibold">{t('walletNostrRecover.title')}</h2>
                    <p className="text-sm text-gray-500">{t('walletNostrRecover.description')}</p>
                </div>

                <div className="app-card flex flex-col gap-4 p-4">
                    <div className="grid grid-cols-2 gap-2">
                        <Button
                            type="button"
                            variant={mode === 'nsec' ? 'default' : 'secondary'}
                            className="w-full"
                            onClick={() => { haptics.impact(); setMode('nsec'); setError(null) }}
                        >
                            <span className="inline-flex items-center gap-2">
                                <AtSign className="h-4 w-4" />
                                {t('walletNostrRecover.modeNsec')}
                            </span>
                        </Button>
                        <Button
                            type="button"
                            variant={mode === 'bunker' ? 'default' : 'secondary'}
                            className="w-full"
                            onClick={() => { haptics.impact(); setMode('bunker'); setError(null) }}
                        >
                            <span className="inline-flex items-center gap-2">
                                <Link2 className="h-4 w-4" />
                                {t('walletNostrRecover.modeBunker')}
                            </span>
                        </Button>
                    </div>

                    <label className="flex flex-col gap-1.5">
                        <span className="text-sm font-medium">
                            {t(mode === 'nsec' ? 'walletNostrRecover.nsecLabel' : 'walletNostrRecover.bunkerLabel')}
                        </span>
                        <input
                            className="h-12 w-full rounded-xl bg-gray-50 px-3 text-base text-gray-900 outline-none focus:ring-2 focus:ring-primary/30"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            value={input}
                            onChange={event => {
                                setInput(event.target.value)
                                setError(null)
                            }}
                            placeholder={t(mode === 'nsec' ? 'walletNostrRecover.nsecPlaceholder' : 'walletNostrRecover.bunkerPlaceholder')}
                        />
                        <span className="text-xs text-gray-500">
                            {t(mode === 'nsec' ? 'walletNostrRecover.nsecHint' : 'walletNostrRecover.bunkerHint')}
                        </span>
                    </label>

                    {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}

                    {!result && (
                        <Button type="submit" className="w-full" disabled={!input.trim() || busy}>
                            {busy && <Spinner size="s" />}
                            {busy
                                ? t('walletNostrRecover.connecting')
                                : t('walletNostrRecover.recoverButton')}
                        </Button>
                    )}

                    {result && (
                        <div className="flex flex-col gap-3">
                            <p className="rounded-xl bg-green-50 p-3 text-sm text-green-700">
                                {t(result.bunker
                                    ? 'walletNostrRecover.bunkerSuccess'
                                    : 'walletNostrRecover.nsecSuccess')}
                            </p>
                            <div className="rounded-xl bg-gray-50 p-3">
                                <p className="text-xs font-medium text-gray-500">
                                    {t('walletNostrRecover.identityLabel')}
                                </p>
                                <p className="mt-1 break-all font-mono text-xs text-gray-800">
                                    {npubFromMnemonicEntropy(result.mnemonic)}
                                </p>
                                {result.bunker && (
                                    <p className="mt-1 text-xs text-gray-500">{t('walletNostrRecover.bunkerIdentityHint')}</p>
                                )}
                            </div>
                            <Button type="button" className="w-full" onClick={continueToWallet}>
                                {t('walletNostrRecover.continueButton')}
                            </Button>
                        </div>
                    )}
                </div>
            </form>
        </Page>
    );
}
