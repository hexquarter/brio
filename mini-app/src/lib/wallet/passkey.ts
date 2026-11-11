const DEFAULT_PRF_SALT = 'com.hexquarter.brio.wallet.v1'

type PrfResults = {
    prf?: {
        results?: {
            first?: ArrayBuffer
        }
    }
}

type Vault = {
    version: 1 | 2
    iv: string
    ciphertext: string
    credentialId?: string
}

const encode = (value: Uint8Array) =>
    btoa(Array.from(value, byte => String.fromCharCode(byte)).join(''))

const decode = (value: string) =>
    Uint8Array.from(atob(value), character => character.charCodeAt(0))

const configuredRpId = () => import.meta.env.VITE_WEBAUTHN_RP_ID?.trim()
const rpId = () => configuredRpId() || window.location.hostname
const rpName = () => import.meta.env.VITE_WEBAUTHN_RP_NAME?.trim() || 'Brio Wallet'
const prfSalt = () => new TextEncoder().encode(
    import.meta.env.VITE_WEBAUTHN_PRF_SALT?.trim() || DEFAULT_PRF_SALT
)

const isIpAddress = (hostname: string) =>
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith('[') || hostname.includes(':')

export const isPasskeySupported = () =>
    window.isSecureContext && !!navigator.credentials && !!window.PublicKeyCredential

/**
 * Explains why passkeys cannot be used on this origin, or null when they can.
 * WebAuthn requires a secure origin and an RP ID that is a registrable domain
 * suffix of the current hostname. IP-address origins (including 127.0.0.1)
 * are not valid RP IDs, so local development must use http://localhost.
 */
export const passkeyUnavailableReason = (): string | null => {
    if (!window.isSecureContext) {
        return 'Passkeys need a secure origin. Run the app over HTTPS (npm run dev:https) instead of plain HTTP or a LAN IP.'
    }
    if (!navigator.credentials || !window.PublicKeyCredential) {
        return 'This browser does not support WebAuthn passkeys. Use a recent Safari, Chrome, Edge, or Firefox.'
    }

    const hostname = window.location.hostname
    if (!configuredRpId() && isIpAddress(hostname)) {
        const port = window.location.port ? `:${window.location.port}` : ''
        return `Passkeys do not work with an IP-address origin (${hostname}). Open the app at http://localhost${port} instead.`
    }

    const id = rpId()
    if (hostname !== id && !hostname.endsWith(`.${id}`)) {
        return `The WebAuthn relying party ID "${id}" does not match this origin (${hostname}).`
    }

    return null
}

const requirePasskeySupport = () => {
    const reason = passkeyUnavailableReason()
    if (reason) throw new Error(reason)
}

/**
 * WebAuthn failures surface as terse DOMExceptions such as "The operation
 * either timed out or was not allowed." Translate the common ones into
 * actionable messages while preserving the original error as the cause.
 */
const withCause = (message: string, cause: unknown): Error => {
    const error = new Error(message)
    ;(error as Error & { cause?: unknown }).cause = cause
    return error
}

const describeWebAuthnError = (error: unknown): Error => {
    if (!(error instanceof DOMException)) {
        return error instanceof Error ? error : new Error(String(error))
    }

    switch (error.name) {
        case 'NotAllowedError':
            return withCause(
                'The passkey prompt was dismissed, timed out, or blocked by this browser. '
                + 'Keep the window focused and use a browser with a platform authenticator '
                + '(Touch ID, Windows Hello, or a security key). WebAuthn also requires '
                + 'HTTPS — run npm run dev:https for local development. Embedded previews, '
                + 'webviews, and iframes usually cannot use passkeys, so open the app in '
                + 'Safari or Chrome.',
                error
            )
        case 'SecurityError':
            return withCause(`This origin is not allowed to use passkeys. ${error.message}`, error)
        case 'InvalidStateError':
            return withCause('This passkey is already registered. Try unlocking the wallet instead.', error)
        case 'NotSupportedError':
            return withCause('This authenticator does not support the required passkey features (PRF).', error)
        case 'AbortError':
            return withCause('The passkey request was cancelled.', error)
        case 'ConstraintError':
            return withCause('This authenticator cannot satisfy the passkey requirements. A user-verifying authenticator is required.', error)
        default:
            return withCause(`${error.name}: ${error.message}`, error)
    }
}

const createCredential = async (options: PublicKeyCredentialCreationOptions) => {
    try {
        return await navigator.credentials.create({ publicKey: options })
    } catch (error) {
        throw describeWebAuthnError(error)
    }
}

const getCredential = async (options: PublicKeyCredentialRequestOptions) => {
    try {
        return await navigator.credentials.get({ publicKey: options })
    } catch (error) {
        throw describeWebAuthnError(error)
    }
}

const requirePrfResult = (credential: Credential | null) => {
    if (!(credential instanceof PublicKeyCredential)) {
        throw new Error('The passkey request was cancelled or is not supported by this browser.')
    }

    const result = (credential.getClientExtensionResults() as PrfResults).prf?.results?.first
    if (!result) {
        throw new Error('This passkey does not support secure PRF key derivation. Use a browser with WebAuthn PRF support or restore with your recovery phrase.')
    }

    return result
}

const deriveEncryptionKey = async (result: ArrayBuffer) => {
    const keyMaterial = await crypto.subtle.importKey('raw', result, 'HKDF', false, ['deriveKey'])
    return crypto.subtle.deriveKey(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: prfSalt(),
            info: new TextEncoder().encode('brio-breez-wallet-encryption-v1')
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    )
}

export const sealWallet = async (mnemonic: string): Promise<string> => {
    requirePasskeySupport()

    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const userId = crypto.getRandomValues(new Uint8Array(32))
    const options = {
        challenge,
        rp: { name: rpName(), id: rpId() },
        user: {
            id: userId,
            name: 'Brio wallet',
            displayName: 'Brio wallet'
        },
        pubKeyCredParams: [
            { type: 'public-key' as const, alg: -7 },
            { type: 'public-key' as const, alg: -257 }
        ],
        authenticatorSelection: {
            // The credential ID is stored in the vault, so the passkey does not
            // need to be discoverable. "preferred" keeps more authenticators usable.
            residentKey: 'preferred' as const,
            userVerification: 'required' as const
        },
        attestation: 'none' as const,
        timeout: 60000,
        extensions: { prf: { eval: { first: prfSalt() } } }
    } as PublicKeyCredentialCreationOptions

    const credential = await createCredential(options)
    if (!(credential instanceof PublicKeyCredential)) {
        throw new Error('The passkey request was cancelled or is not supported by this browser.')
    }

    const key = await deriveEncryptionKey(requirePrfResult(credential))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode(mnemonic)
    )

    const vault: Vault = {
        version: 2,
        iv: encode(iv),
        ciphertext: encode(new Uint8Array(ciphertext)),
        credentialId: encode(new Uint8Array(credential.rawId))
    }
    return JSON.stringify(vault)
}

export const openWallet = async (serializedVault: string): Promise<string> => {
    requirePasskeySupport()

    const vault = JSON.parse(serializedVault) as Vault
    if ((vault.version !== 1 && vault.version !== 2)
        || typeof vault.iv !== 'string'
        || typeof vault.ciphertext !== 'string') {
        throw new Error('The encrypted wallet data is invalid.')
    }

    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const options = {
        challenge,
        rpId: rpId(),
        userVerification: 'required' as const,
        timeout: 60000,
        extensions: { prf: { eval: { first: prfSalt() } } },
        ...(vault.credentialId
            ? { allowCredentials: [{ type: 'public-key' as const, id: decode(vault.credentialId) }] }
            : {})
    } as PublicKeyCredentialRequestOptions

    const credential = await getCredential(options)
    const key = await deriveEncryptionKey(requirePrfResult(credential))
    const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: decode(vault.iv) },
        key,
        decode(vault.ciphertext)
    )
    return new TextDecoder().decode(plaintext)
}
