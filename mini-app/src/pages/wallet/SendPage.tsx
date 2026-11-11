import React from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

import { TelegramSendForm } from '@/components/wallet/TelegramSendForm';
import { BitcoinSendForm } from '@/components/wallet/BitcoinSendForm';
import { haptics } from '@/lib/telegram/ui';

export const WalletSendPage : React.FC = () => {
    const { t } = useTranslation()

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
                <h2 className="text-2xl font-semibold">{t('wallet.send.title')}</h2>
                <p className="text-sm text-gray-500">{t('wallet.send.subtitle')}</p>
            </div>

            <Tabs defaultValue="telegram" onValueChange={() => haptics.selection()}>
                <TabsList>
                    <TabsTrigger value="telegram">{t('wallet.sendTelegram')}</TabsTrigger>
                    <TabsTrigger value="pay">{t('wallet.payBitcoin')}</TabsTrigger>
                </TabsList>
                <TabsContent value="telegram">
                    <TelegramSendForm />
                </TabsContent>
                <TabsContent value="pay">
                    <BitcoinSendForm />
                </TabsContent>
            </Tabs>
        </div>
    )
}
