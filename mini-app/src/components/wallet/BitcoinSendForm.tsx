import { LuCopy, LuScanLine } from "react-icons/lu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useEffect, useRef} from "react";
import { t } from "i18next";
import { Button } from "@/components/ui/button"
import { convertSatsToBtc, convertBtcToSats, formatBtcAmount, formatFiatAmount } from "@/helpers/number";
import { getSessionMnemonic, useWallet } from "@/lib/wallet/context";
import { InputType, Payment, PrepareLnurlPayResponse, PrepareSendPaymentResponse, SendPaymentOptions } from "@breeztech/breez-sdk-spark";
import { Spinner } from "@telegram-apps/telegram-ui";
import { useNavigate, useOutletContext } from "react-router-dom";
import { openQrScanner } from "@telegram-apps/sdk-react";
import { fetchPrice } from "@/lib/wallet/api";
import { publishPayment } from "@/lib/nostr/client";
import { haptics, hasMainButton, useMainButton } from "@/lib/telegram/ui";


export const BitcoinSendForm  = () => {
    const navigate = useNavigate()
    const { breezSdk, currency } = useWallet()
    const [address, setAddress] = useState("")
    const [price, setPrice] = useState(0)
    const [fiatAmount, setFiatAmount] = useState<string | number>("")
    const [btcAmount, setBtcAmount] = useState(0)
    const [prepareResponse, setPrepareResponse] = useState<
        PrepareLnurlPayResponse |
        PrepareSendPaymentResponse |
        undefined
    >(undefined)

    // const [scanner, setScanner] = useState(false)
    const [parseAddressError, setParseAddressError] = useState<string|null>(null)
    const [sendError, setSendError] = useState<string|null>(null)
    const [inputType, setInputType] = useState<InputType | null>(null)
    const [fees, setFees] = useState(0)
    const [loadingPayment, setLoadingPayment] = useState<string | null>(null)

    const [btcBalance] = useOutletContext<any>()
    const [remaining, setRemaining] = useState(0)
    const [loadingAll, setLoadingAll] = useState(false)

    const pasteAddress = async () => {
        const text = await navigator.clipboard.readText();
        setAddress(text)
    }

    const showScanner = async () => {
        const result = await openQrScanner()
        if (result) {
            setAddress(result)
        }
    }

    const publishClientPayment = async (payment: Payment) => {
        const mnemonic = getSessionMnemonic()
        if (!mnemonic) return
        try {
            // The destination pubkey of a Lightning payment is the routing node, not a
            // Nostr identity, so this form cannot resolve a recipient to notify.
            await publishPayment(mnemonic, {
                paymentId: payment.id,
                paymentHash: payment.details?.type === 'lightning'
                    ? payment.details.htlcDetails.paymentHash
                    : undefined,
                amountSats: Number(payment.amount),
                method: payment.details?.type === 'withdraw' ? 'btc' : 'lightning'
            })
        } catch (error) {
            console.error('Unable to publish the payment record:', error)
        }
    }

    // const onScannerResult = (detectedCodes: IDetectedBarcode[]) => {
    //     if (detectedCodes.length == 0) {
    //         return
    //     }
    //     setAddress(detectedCodes[0].rawValue)
    //     setScanner(false)
    // }

    useEffect(() => {
        const handleAddressChange = async (address: string) => {
            setParseAddressError(null)
            try {
                if (!breezSdk) return
                const inputType = await breezSdk.parse(address)
                if (inputType.type != 'bitcoinAddress' &&
                    inputType.type != 'lightningAddress' &&
                    inputType.type != 'lnurlPay' &&
                    inputType.type != 'bolt11Invoice') {
                    setParseAddressError(t('wallet.addressUnknown'))
                    return
                }
                setInputType(inputType)

                const price = await fetchPrice(currency)
                setPrice(price)

                if (inputType.type == 'bolt11Invoice'){
                    if (inputType.amountMsat) {
                        handleAmountChange(inputType.amountMsat * 0.00000000001 * price)
                    }
                }
            }
            catch(e) {
                setParseAddressError((e as Error).message)
            }
        }
        if (breezSdk && address != '') {
            handleAddressChange(address)
        }

    }, [breezSdk, address])

    let debounceTimeout = useRef<number|undefined>(undefined);

    const handleAmountChange = async (amount: number) => {
        if (Number.isNaN(amount)) {
            setFiatAmount("")
            return
        }
        if (amount == 0) {
            return
        }

        setFiatAmount(amount)
        const btc = amount / price
        setBtcAmount(btc)

        if (debounceTimeout.current) {
            clearTimeout(debounceTimeout.current)
        }
        debounceTimeout.current = setTimeout(async () => {
            try {
                setLoadingPayment(t('walletSend.fetchingFees'))
                if (!inputType) return
                switch(inputType.type) {
                    case "lnurlPay":
                        {const prepareResponse = await breezSdk?.prepareLnurlPay({
                            amount: BigInt(convertBtcToSats(btc)),
                            payRequest: inputType,
                        })
                        setLoadingPayment(null)
                        if (!prepareResponse) {
                            throw new Error('Unable to prepare LNURL payment')
                        }
                        const feeSats = prepareResponse.feeSats
                        setFees(feeSats)
                        const remaining = btcBalance - (btc - convertSatsToBtc(feeSats))
                        setRemaining(remaining)
                        if (remaining < 0) {
                            setSendError('Unsufficient funds')
                            return
                        }
                        setPrepareResponse(prepareResponse)}
                        break
                    case "lightningAddress":
                        {const prepareResponse = await breezSdk?.prepareLnurlPay({
                            amount: BigInt(convertBtcToSats(btc)),
                            payRequest: inputType.payRequest,
                        })

                        if (!prepareResponse) {
                            throw new Error('Unable to prepare lightning payment')
                        }
                        const feeSats = prepareResponse.feeSats
                        setFees(feeSats)
                        const remaining = btcBalance - (btc - convertSatsToBtc(feeSats))
                        setRemaining(remaining)
                        if (remaining < 0) {
                            setSendError('Unsufficient funds')
                            return
                        }
                        setPrepareResponse(prepareResponse)}
                        break
                    case "bitcoinAddress":
                        {const prepareResponse = await breezSdk?.prepareSendPayment({
                            paymentRequest: { type: 'input', input: inputType.address },
                            amount: BigInt(convertBtcToSats(btc))
                        })
                         if (!prepareResponse) {
                            throw new Error('Unable to prepare Bitcoin payment')
                        }
                        if (prepareResponse.paymentMethod.type === 'bitcoinAddress') {
                            const feeQuote = prepareResponse.paymentMethod.feeQuote
                            const fastFeeSats = feeQuote.speedFast.userFeeSat + feeQuote.speedFast.l1BroadcastFeeSat
                            setFees(fastFeeSats)
                            const remaining = btcBalance - (btc - convertSatsToBtc(fastFeeSats))
                            setRemaining(remaining)
                            if (remaining < 0) {
                                setSendError('Unsufficient funds')
                                return
                            }
                            setPrepareResponse(prepareResponse)
                            setLoadingPayment(null)
                        }
                        }
                        break
                    case "bolt11Invoice":
                        const prepareResponse = await breezSdk?.prepareSendPayment({
                            paymentRequest: { type: 'input', input: inputType.invoice.bolt11 },
                            amount: inputType.amountMsat ? undefined : BigInt(convertBtcToSats(btc))
                        })
                         if (!prepareResponse) {
                            throw new Error('Unable to prepare Bolt11 payment')
                        }
                        if (prepareResponse.paymentMethod.type === 'bolt11Invoice') {
                            const feeQuote = prepareResponse.paymentMethod.lightningFeeSats + (prepareResponse.paymentMethod.sparkTransferFeeSats || 0)
                            setFees(feeQuote)
                            const reducedBtc = convertSatsToBtc(Number(prepareResponse.amount) + feeQuote)
                            const remaining = btcBalance - reducedBtc
                            if (remaining < 0) {
                                setSendError('Unsufficient funds')
                                return
                            }
                            setPrepareResponse(prepareResponse)
                            setLoadingPayment(null)
                        }
                        setPrepareResponse(prepareResponse)
                }
            }
            catch(e) {
                console.log(e)
                setLoadingPayment(null)
                setSendError((e as Error).message)
            }
            finally {
                setLoadingPayment(null)
            }
        }, 500)

        return () => clearTimeout(debounceTimeout.current)
    }

    const drain = async () => {
        setLoadingAll(true)
        if (!breezSdk) {
            setLoadingAll(false)
            return
        }
        const inputType = await breezSdk.parse(address)
        if (!inputType) {
            setLoadingAll(false)
            return
        }
        let fees = 0
        try {
            switch(inputType.type) {
                case "lnurlPay":
                    const lnUrlPayPrepareResponse = await breezSdk?.prepareLnurlPay({
                        amount: BigInt(convertBtcToSats(btcBalance)),
                        payRequest: inputType,
                    })
                    if (lnUrlPayPrepareResponse) {
                        fees = lnUrlPayPrepareResponse.feeSats
                    }
                    break
                case "lightningAddress":
                    const lnPrepareResponse = await breezSdk?.prepareLnurlPay({
                        amount: BigInt(convertBtcToSats(btcBalance)),
                        payRequest: inputType.payRequest,
                    })
                    if (lnPrepareResponse) {
                        fees = lnPrepareResponse.feeSats
                    }
                    break
                case "bitcoinAddress":
                    const btcPrepareResponse = await breezSdk?.prepareSendPayment({
                        paymentRequest: { type: 'input', input: inputType.address },
                        amount: BigInt(convertBtcToSats(btcBalance))
                    })
                     if (btcPrepareResponse && btcPrepareResponse.paymentMethod.type === 'bitcoinAddress') {
                        const feeQuote = btcPrepareResponse.paymentMethod.feeQuote
                        const fastFeeSats = feeQuote.speedFast.userFeeSat + feeQuote.speedFast.l1BroadcastFeeSat
                        fees = fastFeeSats
                     }
                    break
                case "bolt11Invoice":
                    const bolt11PrepareResponse = await breezSdk?.prepareSendPayment({
                        paymentRequest: { type: 'input', input: inputType.invoice.bolt11 },
                        amount: inputType.amountMsat ? undefined : BigInt(convertBtcToSats(btcBalance))
                    })
                    if (bolt11PrepareResponse && bolt11PrepareResponse.paymentMethod.type === 'bolt11Invoice') {
                        fees = bolt11PrepareResponse.paymentMethod.lightningFeeSats + (bolt11PrepareResponse.paymentMethod.sparkTransferFeeSats || 0)
                    }
                    break
            }
            setLoadingAll(false)
            if (fees == 0) {
                return
            }
            const reducedBtc = btcBalance - convertSatsToBtc(fees)
            await handleAmountChange(parseFloat(formatFiatAmount(reducedBtc * price, 4)))
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
            if (!inputType && !prepareResponse) return
            switch(inputType?.type) {
                case "lnurlPay":
                    {
                        const res = await breezSdk?.lnurlPay({
                            prepareResponse: prepareResponse as PrepareLnurlPayResponse
                        })
                        if (res?.payment) await publishClientPayment(res.payment)
                        await new Promise(r => setTimeout(r, 1000));
                        setLoadingPayment(null)
                        navigate('/wallet/activity')
                    }
                    break
                case "lightningAddress":
                    {
                        const res = await breezSdk?.lnurlPay({
                            prepareResponse: prepareResponse as PrepareLnurlPayResponse
                        })
                        if (res?.payment) await publishClientPayment(res.payment)
                        await new Promise(r => setTimeout(r, 1000));
                        setLoadingPayment(null)
                        navigate('/wallet/activity')
                    }
                    break
                case "bitcoinAddress":
                    {
                        const options: SendPaymentOptions = {
                            type: 'bitcoinAddress',
                            confirmationSpeed: 'fast'
                        }
                        const res = await breezSdk?.sendPayment({
                            prepareResponse: prepareResponse as PrepareSendPaymentResponse,
                            options
                        })
                        if (res?.payment) await publishClientPayment(res.payment)

                        await new Promise(r => setTimeout(r, 1000));
                        setLoadingPayment(null)
                        navigate('/wallet/activity')
                    }
                    break
                case "bolt11Invoice":
                    {
                        const options: SendPaymentOptions = {
                            type: 'bolt11Invoice',
                            preferSpark: false,
                            completionTimeoutSecs: 10
                        }
                        const res = await breezSdk?.sendPayment({
                            prepareResponse: prepareResponse as PrepareSendPaymentResponse,
                            options
                        })
                        if (res?.payment) await publishClientPayment(res.payment)
                        await new Promise(r => setTimeout(r, 1000));
                        setLoadingPayment(null)
                        navigate('/wallet/activity')
                    }
            }
        }
        catch(e) {
            setLoadingPayment(null)
            setSendError((e as Error).message)
        }
        finally{
            setLoadingPayment(null)
        }
    }

    const applyPreset = (fraction: number) => {
        if (!price || !btcBalance) return
        haptics.selection()
        const amount = parseFloat(formatFiatAmount(btcBalance * price * fraction, 2))
        void handleAmountChange(amount)
    }

    const canSend = Boolean(inputType && prepareResponse && !sendError && !parseAddressError)
    const nativeButton = hasMainButton()

    useMainButton({
        text: t('wallet.sendButton'),
        onClick: () => { void handleSend() },
        visible: nativeButton && canSend,
        enabled: nativeButton && canSend && !loadingPayment,
        loading: Boolean(loadingPayment && prepareResponse)
    })

    return (
        <div className='flex flex-col gap-5'>
            <div className="app-card p-4">
                <Label htmlFor="address" className='text-xs font-medium text-gray-400'>{t('wallet.address')}</Label>
                <div className="flex items-center gap-3">
                    <Input
                        id="address"
                        type="text"
                        placeholder={t('wallet.bitcoin.address.placeholder')}
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        autoCorrect="false"
                        autoCapitalize="false"
                        spellCheck="false"/>
                    <button type="button" aria-label="Paste" onClick={() => void pasteAddress()} className="shrink-0 text-gray-400 active:text-primary">
                        <LuCopy className="h-5 w-5" />
                    </button>
                    <button type="button" aria-label="Scan" onClick={() => void showScanner()} className="shrink-0 text-gray-400 active:text-primary">
                        <LuScanLine className="h-5 w-5" />
                    </button>
                </div>
                { parseAddressError &&
                    <p className="mt-2 text-sm text-red-500">{parseAddressError}</p>
                }
            </div>

            { inputType && price > 0 &&
                <div className="app-card flex flex-col gap-3 p-4">
                    <Label htmlFor="amount" className='text-xs font-medium text-gray-400'>
                        {t('wallet.amount')} ({currency})
                    </Label>
                    <div className="relative">
                        <Input
                            id="amount"
                            type="number"
                            min={0}
                            step={0.001}
                            inputMode='decimal'
                            value={fiatAmount}
                            onChange={(e) => handleAmountChange(parseFloat(e.target.value))}
                            className="h-12 border-0 pr-14 text-2xl font-semibold tabular-nums focus-visible:border-0" />
                        <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-400">
                            {currency}
                        </span>
                    </div>
                    <small className="text-xs text-gray-400">{formatBtcAmount(btcAmount)} BTC</small>
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
                            <span>{formatFiatAmount(remaining * price, 4)} {currency}</span>
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
        </div>
    )
}