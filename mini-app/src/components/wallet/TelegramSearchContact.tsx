import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { ChevronsUpDown } from "lucide-react"
import { LuX } from "react-icons/lu"
import { useTranslation } from "react-i18next"

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
    const { t } = useTranslation();

    const normalizeSearch = (search: string) => search ? search.replace(/\s+/g, '') : ''
    const normalizedSearch = normalizeSearch(search || '')
    const normalizedContacts = contacts.map(contact => normalizeSearch(contact))
    return (
        <Popover open={open} onOpenChange={handleOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="h-12 w-full justify-between border-0 bg-gray-50 px-3 font-normal"
                >
                    <span className="truncate">{contact || search || placeholder}</span>
                    <ChevronsUpDown className="opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] rounded-2xl border-black/5 p-2">
                <Command shouldFilter={false}>
                    <CommandInput placeholder={placeholder} className="h-9" onValueChange={(e: string) => handleSelection(normalizeSearch(e))}/>
                    <CommandList>
                        {search &&
                            <CommandGroup heading='Search Result'>
                                <div className={'flex flex-col gap-1'}>
                                    { lookupError &&
                                            <div className="flex flex-col items-start gap-1 px-2 py-1">
                                            <p className="text-xs text-red-500">{lookupError}</p>
                                            <Button variant="link" className="h-auto p-0 text-xs text-gray-500" onClick={() => handleShareInvite()}>
                                                Share an invitation
                                            </Button>
                                        </div>
                                    }
                                    { !lookupError && contact &&
                                        <CommandItem
                                            value={contact}
                                            onSelect={(currentValue: string) => {
                                                handleSelection(normalizeSearch(currentValue) === normalizedSearch ? normalizedSearch : normalizeSearch(currentValue))
                                                handleOpen(false)
                                            }} 
                                            className="flex w-full">
                                            {contact}
                                        </CommandItem>
                                    }
                                </div>
                            </CommandGroup>
                        }
                        { normalizedContacts.length > 0 && 
                            <CommandGroup heading={t('wallet.favourites')}>
                                {normalizedContacts.map((contact: string) => (
                                    <div className={'flex h-10 items-center justify-between gap-2'} key={contact}>
                                        <CommandItem
                                            value={contact}
                                            onSelect={(currentValue: string) => {
                                                handleSelection(normalizeSearch(currentValue) === normalizedSearch ? normalizedSearch : normalizeSearch(currentValue))
                                                handleOpen(false)
                                            }} className="flex w-full">
                                            {contact}
                                        </CommandItem>
                                        <Button variant="ghost" className="h-8 w-8 shrink-0 p-0 text-xs active:bg-primary active:text-white" onClick={() => removeContact(contact)}>
                                            <LuX />
                                        </Button>
                                    </div>
                                ))}
                            </CommandGroup>
                        }
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}
