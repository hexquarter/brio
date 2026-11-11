import { Page } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { storeSessionMnemonic } from "@/lib/wallet/context";
import { cn } from "@/lib/utils";
import { haptics } from "@/lib/telegram/ui";

export function RestoreWalletPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();             

    const [mnemonic, setMnemonic] = useState<string[]>(["", "", "", "", "", "", "", "", "", "", "", ""]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const handlePaste = (e: ClipboardEvent) => {
            e.preventDefault();

            setError(null);
            const clipboardData = e.clipboardData || (window as any).clipboardData;
            const pastedText = clipboardData.getData('Text').trim();
            const passphrase = [...Array(12)].map(() => '');
            const words = pastedText.split(/\s+/)
            words.forEach((word: string, index: number) => {
                passphrase[index] = word;
            });

            if (!bip39.validateMnemonic(passphrase.join(' '), wordlist)) {
                setError(t('walletRestore.invalidMnemonic'));
                return;
            }

            setMnemonic(passphrase);
        };

        // Attach to the first input for simplicity
        const input = document.querySelector('input');
        if (input) {
            input.addEventListener('paste', handlePaste as any);
        }
        return () => {
            if (input) {
                input.removeEventListener('paste', handlePaste as any);
            }
        };
    }, [])

    useEffect(() => {
        if (!bip39.validateMnemonic(mnemonic.join(' '), wordlist)) {
            return;
        }

        // Store in sessionStorage for safe transmission between pages (cleartext for now)
        storeSessionMnemonic(mnemonic.join(' '))
    }, [mnemonic]);

    const valid = bip39.validateMnemonic(mnemonic.join(' '), wordlist)

    const secureWallet = (e: FormEvent) => {
        e.preventDefault()
        haptics.impact()
        navigate('/app/nowallet/secure-wallet')
    }
    
    return (
        <Page back={true}>
            <form className="mx-auto flex w-full max-w-md flex-col gap-6 py-2" onSubmit={secureWallet}>
                <div className="flex flex-col gap-2">
                    <h2 className="text-2xl font-semibold">{t('walletRestore.title')}</h2>
                    <p className="text-sm text-gray-500">{t('walletRestore.description')}</p>
                </div>

                <div className="app-card p-4">
                    <div className="grid grid-cols-3 gap-2">
                        {mnemonic.map((_word, index) => (
                            <div key={index} className="relative">
                                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] tabular-nums text-gray-300">
                                    {index + 1}
                                </span>
                                <input
                                    className={cn(
                                        "h-11 w-full rounded-xl bg-gray-50 pl-6 pr-2 text-base text-gray-900 outline-none transition-shadow focus:ring-2 focus:ring-primary/30",
                                        error && "ring-1 ring-red-300"
                                    )}
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    onChange={(e) => {
                                        setError(null);
                                        const updated = [...mnemonic];
                                        updated[index] = e.target.value;
                                        setMnemonic(updated);
                                    }}
                                    value={mnemonic[index]}
                                />
                            </div>
                        ))}
                    </div>
                    {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
                </div>

                <Button className="w-full" type="submit" disabled={!valid}>
                    {t('walletRestore.nextButton')}
                </Button>
            </form>
        </Page>
    );
}
