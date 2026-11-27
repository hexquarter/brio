export interface Env {
  BOT_TOKEN: string
  NOSTR_PRIVATE_KEY: string
  NOSTR_RELAYS: string
  BOT_USERNAME?: string
  // Cashu mint backing the npubcash inbound rail. Defaults to a public mint.
  CASHU_MINT_URL?: string
  TELEGRAM_WEBHOOK_SECRET?: string
  ENVIRONMENT?: string
  ALLOW_UNVERIFIED_TELEGRAM_DEV?: string
  // Secret used to derive the per-wallet webhook token. Falls back to
  // BOT_TOKEN when not set.
  WEBHOOK_HMAC_SECRET?: string
  // Optional KV namespace. Enables the wallet registry used by the Spark
  // webhook handler, the NIP-05 directory and the npubcash quote store.
  BRIO_KV?: KVNamespace
}
