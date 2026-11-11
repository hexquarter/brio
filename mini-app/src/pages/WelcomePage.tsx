import { useEffect, useState, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Navigate, useNavigate } from "react-router-dom";
import { useWallet } from '@/lib/wallet/context';
import { useLaunchParams } from '@telegram-apps/sdk-react';
import { Bitcoin } from 'lucide-react';
import { haptics } from '@/lib/telegram/ui';

export const WelcomePage: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const wallet = useWallet()
  const tgData = useLaunchParams()
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    void wallet.checkWallet()
      .then(() => setChecked(true))
      .catch(error => {
        console.error('Wallet lookup failed:', error)
        setChecked(true)
      })
  }, [])

  if (!checked) return null
  const startParams = new URLSearchParams(tgData.tgWebAppData?.start_param || '')
  const paymentId = startParams.get('payment')
  if (wallet.walletExists) {
    const target = paymentId
      ? `/app/wallet?payment=${encodeURIComponent(paymentId)}`
      : '/app/wallet'
    return <Navigate to={target} replace />
  }
  if (tgData.tgWebAppData?.start_param) return <Navigate to="/app/nowallet" replace />

  return (
    <div className="app-shell relative flex min-h-screen flex-col overflow-hidden bg-gradient-to-b from-[#FFF7ED] via-white to-white">
      <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-orange-100/70 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-20 h-64 w-64 rounded-full bg-amber-100/60 blur-2xl" />

      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 px-6 py-10 text-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-[#FF942C] to-[#F97316] text-white shadow-lg shadow-orange-200">
          <Bitcoin className="h-10 w-10" />
        </span>
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-4xl font-semibold tracking-tight">
            <span className="font-normal text-gray-400">{t('welcome.title')}</span> Brio
          </h1>
          <p className="max-w-xs text-sm text-gray-500">{t('welcome.description')}</p>
        </div>
      </div>

      <div className="safe-bottom relative mx-auto w-full max-w-md px-6 pb-8">
        <Button
          className="w-full"
          onClick={() => {
            haptics.impact()
            navigate('/app/nowallet')
          }}
        >
          {t('welcome.button')}
        </Button>
      </div>
    </div>
  );
};
