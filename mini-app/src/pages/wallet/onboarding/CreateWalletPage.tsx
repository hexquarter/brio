import { Page } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { storeSessionMnemonic } from '@/lib/wallet/context';
import { ShieldAlert } from 'lucide-react';
import { haptics } from "@/lib/telegram/ui";

export function CreateWalletPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();   

    useEffect(() => {
        const generatedMnemonic = bip39.generateMnemonic(wordlist);
        storeSessionMnemonic(generatedMnemonic)
    }, []);

    const next = () => {
        haptics.impact()
        navigate('/app/nowallet/secure-wallet')
    }

    return (
        <Page back={true}>
            <div className="mx-auto flex w-full max-w-md flex-col gap-6 py-2">
                <div className="flex flex-col gap-2">
                    <h2 className="text-2xl font-semibold">{t('walletCreate.title')}</h2>
                    <p className="text-sm text-gray-500">{t('walletCreate.description')}</p>
                </div>

                <div className="app-card flex items-start gap-3 border-amber-200 bg-amber-50 p-4" role="alert">
                    <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                    <p className="text-sm text-amber-900">{t('walletCreate.warning')}</p>
                </div>

                <Button className="w-full" onClick={next}>{t('walletCreate.nextButton')}</Button>
            </div>
        </Page>
    );
}
