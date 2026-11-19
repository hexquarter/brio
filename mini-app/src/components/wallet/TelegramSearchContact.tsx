import React, { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, ChevronRight, Search, ShieldAlert, Trash2, X } from "lucide-react"
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { haptics } from "@/lib/telegram/ui"
import { cn } from "@/lib/utils"

type Props = {
    open: boolean
    handleOpen: (opened: boolean) => void
    handleSelection: (contact: string) => void
    search: string | undefined
    contacts: string[]
    handleShareInvite: () => void
    lookupError: string | null,
    placeholder: string
    removeContact: (contact: string) => void,
    contact: string | undefined
}

const normalizeSearch = (value: string) => value ? value.replace(/\s+/g, '') : ''

const contactInitial = (contact: string) => {
    const value = contact.replace(/^@/, '')
    return value.charAt(0).toUpperCase() || '#'
}

export const SearchContactForm: React.FC<Props> = ({
    open,
    handleOpen,
    search,
    contact,
    contacts,
    handleSelection,
    handleShareInvite,
    lookupError,
    placeholder,
    removeContact
}) => {
    const { t } = useTranslation()
    const [query, setQuery] = useState(search ?? '')

    // Open on the saved contacts, like a native picker. Keep the failed query
    // visible when the sheet is reopened to explain why it did not resolve.
    useEffect(() => {
        if (!open) return
        setQuery(lookupError ? (search ?? '') : '')
    }, [open])

    const normalizedQuery = normalizeSearch(query)
    const normalizedContacts = contacts.map(normalizeSearch)

    const openSheet = () => {
        haptics.impact()
        handleOpen(true)
    }

    const closeSheet = (opened: boolean) => {
        if (!opened) haptics.selection()
        handleOpen(opened)
    }

    const select = (value: string) => {
        haptics.selection()
        // Close first so a stale lookup error cannot clear the new selection.
        handleOpen(false)
        handleSelection(normalizeSearch(value))
    }

    const remove = (value: string) => {
        haptics.impact('medium')
        removeContact(value)
    }

    const changeQuery = (value: string) => {
        setQuery(value)
        // The parent debounces the actual lookup, so every keystroke can update
        // the shared search value safely.
        handleSelection(normalizeSearch(value))
    }

    const clearQuery = () => {
        haptics.selection()
        changeQuery('')
    }

    const shareInvite = () => {
        haptics.impact()
        handleShareInvite()
    }

    return (
        <>
            <button
                type="button"
                onClick={openSheet}
                aria-haspopup="dialog"
                aria-expanded={open}
                className="flex h-12 w-full items-center gap-3 rounded-2xl bg-gray-50 px-3 text-left transition-colors active:bg-gray-100"
            >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-gray-400 shadow-xs">
                    <Search className="h-4 w-4" />
                </span>
                <span className={cn(
                    'min-w-0 flex-1 truncate text-sm',
                    contact || search ? 'font-medium text-gray-900' : 'text-gray-400'
                )}>
                    {contact || search || t('wallet.telegram.chooseContact')}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
            </button>

            {!open && lookupError && (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">
                    {lookupError}
                </p>
            )}

            <Dialog open={open} onOpenChange={closeSheet}>
                <DialogContent
                    showCloseButton={false}
                    className="inset-x-0 bottom-0 top-auto mx-auto flex max-h-[88dvh] w-full max-w-md translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-3xl rounded-b-none border-0 p-0 pb-[env(safe-area-inset-bottom)] shadow-2xl data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100 data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom data-[state=open]:duration-300 data-[state=closed]:duration-200 sm:max-w-md"
                >
                    <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-gray-300" />

                    <div className="flex items-center justify-between gap-3 px-5 pb-1 pt-3">
                        <DialogTitle className="text-lg font-semibold">
                            {t('wallet.telegram.chooseContact')}
                        </DialogTitle>
                        <DialogClose asChild>
                            <button
                                type="button"
                                aria-label={t('common.close')}
                                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition-colors active:bg-gray-200"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </DialogClose>
                    </div>

                    <DialogDescription className="px-5 pb-3 text-sm text-gray-500">
                        {t('wallet.telegram.chooseContactDescription')}
                    </DialogDescription>

                    <div className="px-5 pb-3">
                        <div className="flex items-center gap-2 rounded-2xl bg-gray-100 px-3 transition-shadow focus-within:ring-2 focus-within:ring-primary/30">
                            <Search className="h-4 w-4 shrink-0 text-gray-400" />
                            <input
                                value={query}
                                onChange={event => changeQuery(event.target.value)}
                                placeholder={placeholder}
                                inputMode="text"
                                autoCapitalize="none"
                                autoCorrect="off"
                                spellCheck={false}
                                className="h-12 w-full bg-transparent text-base text-gray-900 outline-none placeholder:text-gray-400"
                            />
                            {query && (
                                <button
                                    type="button"
                                    onClick={clearQuery}
                                    aria-label={t('wallet.telegram.clearSearch')}
                                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors active:bg-gray-200"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
                        {normalizedQuery.length > 0 && (
                            <div className="flex flex-col gap-2 pb-2">
                                <p className="px-2 pt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                                    {t('wallet.telegram.searchResult')}
                                </p>

                                {lookupError && (
                                    <div className="rounded-2xl border border-red-100 bg-red-50 p-4">
                                        <div className="flex items-start gap-3">
                                            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm text-red-700">{lookupError}</p>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="mt-3 h-11 w-full px-4"
                                                    onClick={shareInvite}
                                                >
                                                    {t('wallet.telegram.shareInvitation')}
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {!lookupError && contact && (
                                    <button
                                        type="button"
                                        onClick={() => select(contact)}
                                        className="flex w-full items-center gap-3 rounded-2xl border border-primary/20 bg-orange-50 px-3 py-3 text-left transition-colors active:bg-orange-100"
                                    >
                                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white">
                                            <Check className="h-5 w-5" />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate font-medium">{contact}</span>
                                            <span className="block text-xs text-primary/80">
                                                {t('wallet.telegram.useContact')}
                                            </span>
                                        </span>
                                        <ChevronRight className="h-4 w-4 shrink-0 text-primary/60" />
                                    </button>
                                )}

                                {!lookupError && !contact && (
                                    <div className="flex items-center gap-3 rounded-2xl bg-gray-50 px-4 py-4 text-sm text-gray-500">
                                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-primary" />
                                        {t('wallet.telegram.searching')}
                                    </div>
                                )}
                            </div>
                        )}

                        {normalizedQuery.length === 0 && normalizedContacts.length > 0 && (
                            <div className="flex flex-col">
                                <p className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                                    {t('wallet.favourites')}
                                </p>
                                {normalizedContacts.map((favorite: string) => (
                                    <div key={favorite} className="flex items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => select(favorite)}
                                            className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-2 py-3 text-left transition-colors active:bg-gray-50"
                                        >
                                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-100 text-sm font-semibold text-primary">
                                                {contactInitial(favorite)}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate font-medium">{favorite}</span>
                                                <span className="block text-xs text-gray-400">
                                                    {t('wallet.telegram.recentContact')}
                                                </span>
                                            </span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => remove(favorite)}
                                            aria-label={t('wallet.telegram.removeContact')}
                                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-300 transition-colors active:bg-red-50 active:text-red-500"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {normalizedQuery.length === 0 && normalizedContacts.length === 0 && (
                            <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
                                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-gray-400">
                                    <Search className="h-6 w-6" />
                                </span>
                                <div className="flex flex-col gap-1">
                                    <p className="font-medium">{t('wallet.telegram.noContacts')}</p>
                                    <p className="text-sm text-gray-500">{t('wallet.telegram.noContactsHint')}</p>
                                </div>
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    )
}
