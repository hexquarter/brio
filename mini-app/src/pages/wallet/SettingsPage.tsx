import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@/lib/wallet/context';
import { hasSecureExport } from '@/lib/wallet/backup';
import { haptics } from '@/lib/telegram/ui';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

const currencies = [
    'USD', 
    'EUR',
    'GBP',
    'RUB', 
    'JPY', 
    'CAD',
    'CHF',
    'CNY',
    'KRW',
    'AUD',
    'NZD',
    'SGD',
    'KZT', 
    'NGN',
    'INR',
    'ZAR',
    'SEK',
    'MXN'
] 

const languages = [
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'Français' },
    { code: 'es', label: 'Español' },
    { code: 'zh', label: '中文' },
    { code: 'hi', label: 'हिन्दी' },
]

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <h3 className="px-4 pt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">{children}</h3>
)

const dangerRowClass = "flex w-full items-center justify-between gap-3 py-3 text-left"

const DangerRowContent = ({ label, description }: { label: string; description: string }) => (
    <>
        <span className="flex flex-col">
            <span className="text-sm font-medium text-red-600">{label}</span>
            <span className="text-xs text-gray-400">{description}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
    </>
)

export const WalletSettingsPage : React.FC = () => {
    const navigate = useNavigate()
    const { t, i18n } = useTranslation()
    const { currency, changeCurrency, resetWallet} = useWallet()
    const exportSaved = hasSecureExport()
    const currentLanguage = i18n.language.split('-')[0]

    const changeLanguage = (code: string) => {
        haptics.selection()
        void i18n.changeLanguage(code)
    }

    const reset = async () => {
        try {
            await resetWallet()
            haptics.success()
            window.location.replace('/#/app/nowallet');
        } catch {
            haptics.error()
        }
    }

    const deletePermanently = async () => {
        try {
            await resetWallet({ deleteBackup: true })
            haptics.success()
            window.location.replace('/#/app/nowallet');
        } catch {
            haptics.error()
        }
    }

    return (
        <div className="flex flex-col gap-5">
            <h2 className="text-2xl font-semibold">{t('wallet.settings')}</h2>

            <section className="app-card divide-y divide-black/5">
                <SectionTitle>{t('wallet.settings.preferences')}</SectionTitle>
                <div className="divide-y divide-black/5 px-4">
                    <div className="flex items-center justify-between py-3">
                        <span className="text-sm">{t('wallet.settings.currency')}</span>
                        <Select value={currency} onValueChange={changeCurrency}>
                            <SelectTrigger className="h-8 w-28 justify-end border-0 px-0 shadow-none">
                                <SelectValue placeholder={currency} />
                            </SelectTrigger>
                            <SelectContent>
                                {currencies.map(currency => (
                                    <SelectItem key={currency} value={currency}>{currency}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex items-center justify-between py-3">
                        <span className="text-sm">{t('wallet.settings.language')}</span>
                        <Select value={currentLanguage} onValueChange={changeLanguage}>
                            <SelectTrigger className="h-8 w-28 justify-end border-0 px-0 shadow-none">
                                <SelectValue placeholder={currentLanguage} />
                            </SelectTrigger>
                            <SelectContent>
                                {languages.map(({ code, label }) => (
                                    <SelectItem key={code} value={code}>{label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </section>

            <section className="app-card divide-y divide-black/5">
                <SectionTitle>{t('wallet.settings.security')}</SectionTitle>
                <div className="divide-y divide-black/5 px-4">
                    <div className="flex items-center justify-between py-3">
                        <span className="text-sm">{t('wallet.settings.backupStatus')}</span>
                        <span className={cn(
                            'inline-flex items-center gap-1.5 text-sm font-medium',
                            exportSaved ? 'text-green-600' : 'text-amber-600'
                        )}>
                            <span className={cn(
                                'h-1.5 w-1.5 rounded-full',
                                exportSaved ? 'bg-green-500' : 'bg-amber-500'
                            )} />
                            {exportSaved ? t('wallet.settings.backupSaved') : t('wallet.settings.backupNotSaved')}
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            haptics.impact()
                            navigate('/app/wallet/backup')
                        }}
                        className="flex w-full items-center justify-between gap-3 py-3 text-left"
                    >
                        <span className="flex flex-col">
                            <span className="text-sm font-medium">{t('wallet.settings.backup')}</span>
                            <span className="text-xs text-gray-400">{t('wallet.settings.backupDescription')}</span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                    </button>
                </div>
            </section>

            <section className="app-card divide-y divide-black/5">
                <SectionTitle>{t('wallet.settings.dangerZone')}</SectionTitle>
                <div className="divide-y divide-black/5 px-4">
                    <AlertDialog>
                        <AlertDialogTrigger className={dangerRowClass} onClick={() => haptics.impact()}>
                            <DangerRowContent
                                label={t('wallet.settings.reset')}
                                description={t('wallet.settings.resetDescription')}
                            />
                        </AlertDialogTrigger>
                        <AlertDialogContent className='border-0'>
                            <AlertDialogHeader>
                                <AlertDialogTitle>{t('wallet.settings.resetQuestion')}</AlertDialogTitle>
                                <AlertDialogDescription>{t('wallet.settings.resetWarning')}</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter className='flex flex-row'>
                                <AlertDialogCancel>{t('wallet.settings.resetCancel')}</AlertDialogCancel>
                                <AlertDialogAction onClick={() => void reset()}>{t('wallet.settings.resetConfirmation')}</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>

                    <AlertDialog>
                        <AlertDialogTrigger className={dangerRowClass} onClick={() => haptics.impact()}>
                            <DangerRowContent
                                label={t('wallet.settings.deleteBackup')}
                                description={t('wallet.settings.deleteBackupDescription')}
                            />
                        </AlertDialogTrigger>
                        <AlertDialogContent className='border-0'>
                            <AlertDialogHeader>
                                <AlertDialogTitle>{t('wallet.settings.resetQuestion')}</AlertDialogTitle>
                                <AlertDialogDescription>{t('wallet.settings.deleteBackupWarning')}</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter className='flex flex-row'>
                                <AlertDialogCancel>{t('wallet.settings.resetCancel')}</AlertDialogCancel>
                                <AlertDialogAction onClick={() => void deletePermanently()}>{t('wallet.settings.resetConfirmation')}</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </section>
        </div>
    )
}
