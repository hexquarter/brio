/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_BREEZ_API_KEY: string
    readonly VITE_BACKEND_ENDPOINT: string
    readonly VITE_NOSTR_RELAYS?: string
    readonly VITE_NOSTR_SERVICE_PUBKEY?: string
    readonly VITE_WEBAUTHN_RP_ID?: string
    readonly VITE_WEBAUTHN_RP_NAME?: string
    readonly VITE_WEBAUTHN_PRF_SALT?: string
    readonly VITE_TELEGRAM_BOT_USERNAME?: string
    readonly VITE_COINGECKO_DEMO_API_KEY?: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}