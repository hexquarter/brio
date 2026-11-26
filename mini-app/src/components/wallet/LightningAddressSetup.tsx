import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AtSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWallet } from '@/lib/wallet/context';
import { getTelegramUsername } from '@/lib/telegram/username';
import { haptics } from '@/lib/telegram/ui';

// Lets the user claim a Lightning address username (user@domain) directly
// from the Receive page.
export const LightningAddressSetup = ({ onDone }: { onDone: () => void }) => {
    const { t } = useTranslation()
    const { claimLightningAddress } = useWallet()

    const [username, setUsername] = useState(getTelegramUsername() ?? '')
    const [claiming, setClaiming] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const claim = async () => {
        if (claiming) return
        haptics.impact()
        setClaiming(true)
        setError(null)
        const result = await claimLightningAddress(username)
        setClaiming(false)
        if (result === 'registered') {
            haptics.success()
            toast.success(t('wallet.receive.customizeAddress.success'))
            onDone()
            return
        }
        haptics.error()
        setError(t(
            result === 'taken'
                ? 'walletSecure.usernameTaken'
                : result === 'invalid'
                    ? 'walletSecure.usernameInvalid'
                    : 'wallet.receive.customizeAddress.failed',
            result === 'taken' ? { username: username.trim().toLowerCase() } : undefined
        ))
    }

    return (
        <div className="app-card flex flex-col items-center gap-4 p-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-50 text-orange-500">
                <AtSign className="h-6 w-6" />
            </span>
            <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">{t('wallet.receive.customizeAddress.title')}</p>
                <p className="text-xs text-gray-500">{t('wallet.receive.customizeAddress.description')}</p>
            </div>
            <input
                type="text"
                className="h-12 w-full rounded-xl bg-gray-50 px-3 text-center text-base text-gray-900 outline-none focus:ring-2 focus:ring-primary/30"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={username}
                onChange={event => {
                    setUsername(event.target.value)
                    setError(null)
                }}
                placeholder={t('wallet.receive.customizeAddress.placeholder')}
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="button" className="w-full" disabled={claiming} onClick={() => void claim()}>
                {claiming ? t('wallet.receive.customizeAddress.claiming') : t('wallet.receive.customizeAddress.claimButton')}
            </Button>
        </div>
    )
}
