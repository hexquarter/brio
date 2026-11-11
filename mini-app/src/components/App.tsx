import { useEffect, useState, type PropsWithChildren } from 'react';
import { Navigate, Route, Routes, HashRouter, useNavigate } from 'react-router-dom';
import { AppRoot, Spinner } from '@telegram-apps/telegram-ui';
import { useTranslation } from 'react-i18next';
import { useWallet } from '@/lib/wallet/context';
import { passkeyUnavailableReason } from '@/lib/wallet/passkey';
import { Button } from '@/components/ui/button';
import { Fingerprint } from 'lucide-react';
import { haptics } from '@/lib/telegram/ui';
import { WelcomePage } from '@/pages/WelcomePage';
import { MainPage } from '@/pages/MainPage';
import { OnBoardingPage } from '@/pages/wallet/onboarding/OnBoardingPage';
import { CreateWalletPage } from '@/pages/wallet/onboarding/CreateWalletPage';
import { RestoreWalletPage } from '@/pages/wallet/onboarding/RestoreWalletPage';
import { SecureWalletPage } from '@/pages/wallet/onboarding/SecureWalletPage';
import { WalletMainPage } from '@/pages/wallet/MainPage';
import { WalletWelcomePage } from '@/pages/wallet/WelcomePage';
import { WalletReceivePage } from '@/pages/wallet/ReceivePage';
import { WalletSendPage } from '@/pages/wallet/SendPage';
import { WalletActivityPage } from '@/pages/wallet/ActivityPage';
import { WalletActivityDetailsPage } from '@/pages/wallet/ActivityDetailsPage';
import { WalletSettingsPage } from '@/pages/wallet/SettingsPage';
import { BackupWalletPage } from '@/pages/wallet/BackupPage';

type WalletGate = 'checking' | 'locked' | 'unlocking' | 'unlocked'

function WalletRoute({ children }: PropsWithChildren<{}>) {
  const wallet = useWallet()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [gate, setGate] = useState<WalletGate>('checking')
  const [exists, setExists] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const passkeyIssue = passkeyUnavailableReason()

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const found = await wallet.checkWallet()
        if (cancelled) return
        setExists(found)
        // Only prompt for a passkey on an explicit user action. Automatically
        // calling the WebAuthn API on page load is unreliable and surprises
        // users landing on the app from a link.
        setGate(found && !wallet.breezSdk ? 'locked' : 'unlocked')
      } catch (reason) {
        if (cancelled) return
        setExists(true)
        setError(reason instanceof Error ? reason.message : String(reason))
        setGate('locked')
      }
    })()

    return () => { cancelled = true }
  }, [])

  const unlock = async () => {
    setError(null)
    setGate('unlocking')
    haptics.impact()
    try {
      await wallet.unlockWallet()
      haptics.success()
      setGate('unlocked')
    } catch (reason) {
      haptics.error()
      setError(reason instanceof Error ? reason.message : String(reason))
      setGate('locked')
    }
  }

  const resetAndGo = async (path: string) => {
    haptics.impact()
    try {
      await wallet.resetWallet()
    } catch (reason) {
      console.warn('Failed to reset the wallet:', reason)
    }
    navigate(path, { replace: true })
  }

  if (gate === 'checking' || exists === null) {
    return (
      <div className="app-shell flex items-center justify-center p-10">
        <Spinner size="l" />
      </div>
    )
  }

  if (!exists) return <Navigate to="/app/nowallet" replace />

  if (gate === 'unlocked') return <>{children}</>

  return (
    <div className="app-shell mx-auto flex w-full max-w-md flex-col justify-center gap-6 px-5 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#FF942C] to-[#F97316] text-white shadow-sm">
          <Fingerprint className="h-8 w-8" />
        </span>
        <h2 className="text-2xl font-semibold">{t('walletUnlock.title')}</h2>
        <p className="text-sm text-gray-500">{t('walletUnlock.description')}</p>
      </div>

      {passkeyIssue && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-700">{passkeyIssue}</p>
      )}
      {error && (
        <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>
      )}

      <div className="flex flex-col gap-3">
        <Button
          type="button"
          className="w-full"
          disabled={!!passkeyIssue || gate === 'unlocking'}
          onClick={() => void unlock()}
        >
          {gate === 'unlocking' ? t('walletUnlock.unlockingButton') : t('walletUnlock.unlockButton')}
        </Button>
        <Button type="button" variant="secondary" className="w-full" onClick={() => void resetAndGo('/app/nowallet/restore-wallet')}>
          {t('walletUnlock.restoreButton')}
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={() => void resetAndGo('/app/nowallet')}>
          {t('walletUnlock.startOverButton')}
        </Button>
      </div>
    </div>
  )
}

export function App() {
  return (
    <AppRoot>
      <HashRouter>
        <Routes>
          <Route path="/" Component={WelcomePage} />
          <Route path="/app" Component={MainPage}>
            <Route path="wallet" element={
              <WalletRoute>
                <WalletMainPage />
              </WalletRoute>
            }>
              <Route index Component={WalletWelcomePage} />
              <Route path="receive" Component={WalletReceivePage} />
              <Route path="send" Component={WalletSendPage} />
              <Route path="activity" Component={WalletActivityPage} />
              <Route path="activity/:id" Component={WalletActivityDetailsPage} />
              <Route path="settings" Component={WalletSettingsPage} />
              <Route path="backup" Component={BackupWalletPage} />
            </Route>
            <Route path="nowallet">
              <Route index Component={OnBoardingPage} />
              <Route path="create-wallet" Component={CreateWalletPage} />
              <Route path="restore-wallet" Component={RestoreWalletPage} />
              <Route path="secure-wallet" Component={SecureWalletPage} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AppRoot>
  );
}
