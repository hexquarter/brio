export const listContacts = async (): Promise<string[]> => {
    const localContacts = sessionStorage.getItem('contacts')
    if (localContacts) {
        return JSON.parse(localContacts) as string[]
    }
    return []
}

export const addContact = async (contact: string) => {
    let contacts = await listContacts()
    const contactSet = new Set(contacts)
    if (contactSet.has(contact)) {
        return
    }
    contacts = Array.from(contactSet.add(contact))
    sessionStorage.setItem('contacts', JSON.stringify(contacts))
}

export const clearContacts = () => {
    sessionStorage.removeItem('contacts')
}

export const removeContact = async (contact: string) => {
    const contacts = await listContacts()
    const filteredContacts = contacts.filter(c => c != contact)
    sessionStorage.setItem('contacts', JSON.stringify(filteredContacts))
}
