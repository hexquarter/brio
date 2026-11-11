import { useEffect, useRef, useState } from "react"
import { t } from "i18next"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { convertBtcToSats, convertSatsToBtc, formatBtcAmount, formatFiatAmount } from "@/helpers/number"
import { fetchBotInfo, fetchPrice, normalizeContact, notifyPayment } from "@/lib/wallet/api"
import { Spinner } from "@telegram-apps/telegram-ui"
import { getSessionMnemonic, useWallet } from '@/lib/wallet/context.tsx';
import { useNavigate, useOutletContext } from "react-router-dom"
import { PrepareLnurlPayResponse, SdkEvent } from "@breeztech/breez-sdk-spark/web"
import { toast } from "sonner"
import { openTelegramLink, retrieveLaunchParams } from "@telegram-apps/sdk-react"
import { addContact, listContacts, removeContact } from "@/lib/wallet/contact"
import { SearchContactForm } from "./TelegramSearchContact"
import { lookupProfile, publishPayment } from "@/lib/nostr/client"
import { hash } from "@/helpers/crypto"
import { haptics, hasMainButton, useMainButton } from "@/lib/telegram/ui"
export const TelegramSendForm = () => {
    const navigate = useNavigate()
    const { breezSdk, currency } = useWallet()
    const [contact, setContact] = useState("")
    const [search, setSearch] = useState("")
    const [address, setAddress] = useState("")
    const [recipientPubkey, setRecipientPubkey] = useState<string | undefined>(undefined)
    const [fiatAmount, setFiatAmount] = useState<string | number>("")
    const [btcAmount, setBtcAmount] = useState(0)
    const [lookupError, setLookupError] = useState<string | null>(null)
    const [sendError, setSendError] = useState<string|null>(null)
    const [price, setPrice] = useState(0)
    const [prepareResponse, setPrepareResponse] = useState<PrepareLnurlPayResponse | undefined>(undefined)
    const [fees, setFees] = useState(0)
    const [loadingPayment, setLoadingPayment] = useState<null | string>(null)
    const [contacts, setContacts] = useState<string[]>([])

    const [btcBalance] = useOutletContext<any>()
    const [remaining, setRemaining] = useState(0)
    const [loadingAll, setLoadingAll] = useState(false)

    useEffect(() => {
        setLookupError(null)
        if (search == "" ||  !breezSdk) return
        const delayDebounceFn = setTimeout(async () => {
            const strippedContact = search.startsWith('@')
                ? search.slice(1, search.length)
                : search
            try {
                const result = await lookupProfile(strippedContact)
                if (result) {
                    setAddress(result.address)
                    setRecipientPubkey(result.publicKey)
                    const price = await fetchPrice(currency)
                    setPrice(price)
                    setContact(strippedContact.startsWith("+") ? strippedContact : `@${strippedContact}`)
                    // let contactSet = new Set(contacts)
                    // contactSet = contact.startsWith("+") ? contactSet.add(contact) : contactSet.add(`@${strippedContact}`)
                    // setContacts(Array.from(contactSet))
                    return
                }

                setContact("")
                setRecipientPubkey(undefined)
                setLookupError(t('wallet.telegram.notFound'))
            }
            catch(e) {
                setLookupError((e as Error).message)
            }
        }, 500)

        return () => clearTimeout(delayDebounceFn)
    }, [search])

    useEffect(() => {
        const loadContacts = async () => {
            const _contacts = await listContacts()
            setContacts(_contacts)
        }

        loadContacts()
    }, [])

    let debounceTimeout = useRef<number|undefined>(undefined);

    const parsePayRequest = async (value: string) => {
        if (!breezSdk) throw new Error('Wallet is not ready')
        const input = await breezSdk.parse(value)
        if (input.type == 'lnurlPay') return input
        if (input.type == 'lightningAddress') return input.payRequest
        return undefined
    }

    const handleAmountChange = (amount: number) => {
        setSendError(null)

        if (Number.isNaN(amount)) {
            setFiatAmount("")
            return
        }

        setFiatAmount(amount)

        if (amount == 0) {
            return
        }

        const btc = amount / price
        setBtcAmount(btc)

        if (debounceTimeout.current) {
            clearTimeout(debounceTimeout.current)
        }
        debounceTimeout.current = setTimeout(async () => {
            try {
                setSendError(null)
                setLoadingPayment(t('walletSend.fetchingFees'))
                const payRequest = await parsePayRequest(address)
                if (!payRequest) {
                    setLoadingPayment(null)
                    setSendError(t('wallet.invalidAddress'))
                    return
                }

                const prepareResponse = await breezSdk?.prepareLnurlPay({
                    amount: BigInt(convertBtcToSats(btc)),
                    payRequest,
                    comment: 'Pay via Brio',
                })
                setLoadingPayment(null)
                if (!prepareResponse) {
                    return
                }
                const feeSats = prepareResponse.feeSats
                setFees(feeSats)
                const reducedBtc = convertSatsToBtc(prepareResponse.amountSats + prepareResponse.feeSats)
                const remaining = btcBalance - reducedBtc
                setRemaining(remaining)
                if (remaining < 0) {
                    setSendError('Unsufficient funds')
                    return
                }
                prepareResponse.invoiceDetails.description = 'Pay via Brio to ' + contact
                setPrepareResponse(prepareResponse)
            }
            catch(e) {
                setLoadingPayment(null)
                const err = e as Error
                console.error(e)
                if (err.message == 'Lnurl error: error calling lnurl endpoint: Json error: data did not match any variant of untagged enum LnurlRequestDetails') {
                    setSendError('Lightning address not registered on Spark')
                    return
                }
                setSendError((e as Error).message)
            }
        }, 500)

        return () => clearTimeout(debounceTimeout.current)
    }

    const drain = async () => {
        setLoadingAll(true)
        const payRequest = await parsePayRequest(address)
        if (!payRequest) {
            setLoadingAll(false)
            setSendError(t('wallet.invalidAddress'))
            return
        }

        try {
            let prepareResponse = await breezSdk?.prepareLnurlPay({
                amount: BigInt(convertBtcToSats(btcBalance)),
                payRequest
            })
            setLoadingAll(false)
            if (!prepareResponse) {
                return

            }
            const reducedBtc = btcBalance - convertSatsToBtc(prepareResponse.feeSats)
            handleAmountChange(parseFloat(formatFiatAmount(reducedBtc * price, 4)))
        }
        catch (e) {
            setLoadingAll(false)
            const error = e as Error
            setSendError(error.message)
        }

    }

    const handleSend = async () => {
        setSendError(null)
        setLoadingPayment(t('wallet.sendPaymentPending'))
        try {

            let listenerId: string | undefined

            class EventListener {
                async onEvent(event: SdkEvent) {
                    switch(event.type) {
                        case 'paymentSucceeded':
                            if (event.payment.paymentType == 'send' && event.payment.status == 'completed') {
                                if (event.payment.details?.type == 'lightning') {
                                    try {
                                        const mnemonic = getSessionMnemonic()
                                        if (mnemonic) {
                                            const recipientContact = contact
                                                ? await hash(normalizeContact(contact))
                                                : undefined
                                            const paymentEvent = await publishPayment(mnemonic, {
                                                paymentId: event.payment.id,
                                                paymentHash: event.payment.details.htlcDetails.paymentHash,
                                                amountSats: Number(event.payment.amount),
                                                method: 'lightning',
                                                recipientPublicKey: recipientPubkey,
                                                recipientContact
                                            })
                                            if (recipientPubkey || recipientContact) {
                                                await notifyPayment(paymentEvent.id)
                                            }
                                        }
                                    } catch (error) {
                                        console.error('Unable to publish the payment notification:', error)
                                    }
                                }
                                if (contact) await addContact(contact)
                                await breezSdk?.removeEventListener(listenerId as string)
                                await new Promise(r => setTimeout(r, 1000));
                                setLoadingPayment(null)
                                navigate('/wallet/activity')
                            }
                            break
                        case 'paymentFailed':
                            if (event.payment.paymentType == 'send' && event.payment.status == 'failed') {
                                await breezSdk?.removeEventListener(listenerId as string)
                                setLoadingPayment(null)
                                setSendError(t('wallet.paymentFailed'))
                            }
                            break
                        default:
                            break
                    }
                }
            }

            listenerId = await breezSdk?.addEventListener(new EventListener())

            await breezSdk?.lnurlPay({
                prepareResponse: prepareResponse as PrepareLnurlPayResponse
            })
        }
        catch(e) {
            console.error(e)
            setLoadingPayment(null)
            setSendError((e as Error).message)
        }
    }

    const applyPreset = (fraction: number) => {
        if (!price || !btcBalance) return
        haptics.selection()
        const amount = parseFloat(formatFiatAmount(btcBalance * price * fraction, 2))
        handleAmountChange(amount)
    }

    const canSend = Boolean(address && prepareResponse && !sendError)
    const nativeButton = hasMainButton()

    useMainButton({
        text: t('wallet.sendButton'),
        onClick: () => { void handleSend() },
        visible: nativeButton && canSend,
        enabled: nativeButton && canSend && !loadingPayment,
        loading: Boolean(loadingPayment && prepareResponse)
    })

    const shareInvite = async () => {
        const tgData = retrieveLaunchParams()
        const startParam = new URLSearchParams()
        startParam.append('referral', tgData.tgWebAppData?.user?.id.toString() as string)
        const encodedStartParam = encodeURIComponent(startParam.toString())
        const botInfo = await fetchBotInfo()
        const miniappLink = `https://t.me/${botInfo.username}?startapp=${encodedStartParam}`;
        if (openTelegramLink.isAvailable()) {
            openTelegramLink(
                `https://t.me/share/url?url=${encodeURIComponent(miniappLink)}&text=${encodeURIComponent("Use Bitcoin on Telegram")}`
            )
        }
        else {
            navigator.clipboard.writeText(miniappLink)
            toast.info('Invitation link copied. Share it via Telegram manually')
        }
    }

    const [open, setOpen] = useState(false)

    const handleOpen = (opened: boolean) => {
        if (!opened) {
            if (lookupError) {
                setLookupError("")
                setSearch("")
            }
        }
        console.log('handleOpen', opened)
        setOpen(opened)
    }

    const removeFavoriteContact = async (contact: string) => {
        await removeContact(contact)
        setContacts(await listContacts())
        setOpen(false)
    }

    return (
        <div className='flex flex-col gap-5'>
            <div className='flex flex-col gap-1'>
                <Label className='mb-1 text-xs font-medium text-gray-400'>{t('wallet.telegram.contact')}</Label>
                <SearchContactForm
                    placeholder={t('wallet.telegram.contact.placeholder')}
                    open={open}
                    handleOpen={handleOpen}
                    handleSelection={setSearch}
                    handleShareInvite={shareInvite}
                    lookupError={lookupError}
                    contacts={contacts}
                    search={search}
                    contact={contact}
                    removeContact={removeFavoriteContact}
                />
            </div>

            { address != '' && price > 0 && !lookupError &&
                <div className="app-card flex flex-col gap-3 p-4">
                    <Label htmlFor="amount" className='text-xs font-medium text-gray-400'>
                        {t('wallet.amount')} ({currency})
                    </Label>
                    <div className="relative">
                        <Input
                            id="amount"
                            type="number"
                            inputMode="decimal"
                            min={0.01}
                            step={0.01}
                            value={fiatAmount}
                            onChange={(e) => handleAmountChange(parseFloat(e.target.value))}
                            className="h-12 border-0 pr-14 text-2xl font-semibold tabular-nums focus-visible:border-0"
                            />
                        <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-400">
                            {currency}
                        </span>
                    </div>
                    {fiatAmount != '' && (
                        <small className="text-xs text-gray-400">{formatBtcAmount(btcAmount)} BTC</small>
                    )}
                    <div className="flex gap-2">
                        {[0.25, 0.5, 0.75].map(fraction => (
                            <button
                                key={fraction}
                                type="button"
                                onClick={() => applyPreset(fraction)}
                                className="flex-1 rounded-xl bg-gray-100 py-2 text-xs font-medium text-gray-600 transition-colors active:bg-gray-200"
                            >
                                {fraction * 100}%
                            </button>
                        ))}
                        <button
                            type="button"
                            onClick={() => { haptics.selection(); void drain() }}
                            className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-gray-100 py-2 text-xs font-medium text-gray-600 transition-colors active:bg-gray-200"
                        >
                            {t('wallet.send.all')}
                            {loadingAll && <Spinner size="s" />}
                        </button>
                    </div>
                </div>
            }
            {address != '' && !lookupError &&
                <div className="flex flex-col gap-3">
                    {fees > 0 && !sendError &&
                        <div className="app-card flex flex-col gap-2 p-4 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-400">{t('fees')}</span>
                                <span className="tabular-nums">{formatBtcAmount(convertSatsToBtc(fees))} BTC</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-400">{t('remaining')}</span>
                                <span className="tabular-nums">{formatBtcAmount(remaining)} BTC</span>
                            </div>
                            <div className="flex justify-between text-xs text-gray-400">
                                <span />
                                <span>{formatFiatAmount(remaining * price)} {currency}</span>
                            </div>
                        </div>
                    }
                    {!nativeButton && !sendError && canSend &&
                        <Button className="w-full" disabled={!!loadingPayment} onClick={() => void handleSend()}>
                            {loadingPayment && <Spinner size="s" />}
                            {t('wallet.sendButton')}
                        </Button>
                    }
                    {loadingPayment &&
                        <div className='flex items-center justify-center gap-2 text-xs text-gray-500'>
                            <Spinner size="s"/>
                            <span>{loadingPayment}</span>
                        </div>
                    }
                    { sendError &&
                        <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{sendError}</p>
                    }
                </div>
            }

        </div>
    )
}