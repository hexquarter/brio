import { Clock3, House, Settings } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { haptics } from '@/lib/telegram/ui'

export function WalletNav() {
    const { t } = useTranslation()

    const items = [
        { to: '/app/wallet', label: t('wallet.menuHome'), icon: House, end: true },
        { to: '/app/wallet/activity', label: t('wallet.menuActivity'), icon: Clock3, end: false },
        { to: '/app/wallet/settings', label: t('wallet.settings'), icon: Settings, end: false }
    ]

    return (
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md border-t border-black/5 bg-white/95 backdrop-blur">
            <div className="flex items-stretch justify-around px-2 pt-1">
                {items.map(({ to, label, icon: Icon, end }) => (
                    <NavLink
                        key={to}
                        to={to}
                        end={end}
                        onClick={() => haptics.selection()}
                        className={({ isActive }) => cn(
                            'flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium transition-colors',
                            isActive ? 'text-primary' : 'text-gray-400'
                        )}
                    >
                        {({ isActive }) => (
                            <>
                                <span className={cn(
                                    'flex h-9 w-14 items-center justify-center rounded-full transition-colors',
                                    isActive && 'bg-orange-50'
                                )}>
                                    <Icon className="h-5 w-5" />
                                </span>
                                <span className="max-w-full truncate">{label}</span>
                            </>
                        )}
                    </NavLink>
                ))}
            </div>
        </nav>
    )
}
