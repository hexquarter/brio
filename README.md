# Brio Bitcoin Wallet

Brio is a Telegram Mini App for managing Bitcoin and Lightning payments with the Breez SDK Spark (`@breeztech/breez-sdk-spark` 0.28). It is a single-purpose wallet; polls, app switching, support messaging, and database-backed user services have been removed.

## Wallet security

Wallet onboarding creates a Breez-compatible recovery seed locally. A WebAuthn passkey with the PRF extension derives an encryption key for that seed; only the encrypted vault is saved in browser storage. Brio does not use Telegram Cloud Storage for any wallet material. The passkey assertion is required to unlock the wallet. The recovery phrase can be exported from wallet settings and remains the recovery path if the passkey is unavailable. The app records whether a secure export has been completed and keeps a reminder on the wallet home screen until it is.

Passkey PRF requires a secure origin and an authenticator/browser that supports WebAuthn PRF. Brio does not send wallet seed material or passkey credentials to the backend. The Breez SDK still receives the decrypted recovery seed locally when it is initialized.

## Nostr identity and metadata

The wallet derives its Nostr identity from the wallet mnemonic using NIP-06 (`m/44'/1237'/0'/0/0`). Profile and payment events are signed and published by the client:

- **Profile** — standard Nostr kind `0`. The content contains the Lightning address, LNURL, Bitcoin address, and taproot address. `contact` tags contain SHA-256 digests of the Telegram username.
- **Payment** — addressable kind `30078` with `d=brio:payment:<paymentId>`, `t=brio-payment`, and an optional `p` recipient pubkey or `contact` digest. Content is NIP-44 encrypted to the Brio service public key. Lightning payments also include the shared `paymentHash`, which the Telegram notification uses to open the received payment.
- **Verification attestation** — published by the backend after validating Telegram init data. Kind `30078`, `d=brio:verified:<nostrPubkey>`, `p=<nostrPubkey>`, `e=<profileEventId>`, `t=brio-verified`. Content is NIP-44 encrypted to the service key.

Contact lookup happens client-side: the client normalizes and hashes the handle (or phone number), queries relays for the service's verification attestation with that `contact` hash, then reads the referenced kind `0` profile. Only the Telegram username from signed init data is attested; phone-number hashes are not verified because Telegram init data does not contain a verifiable phone number.

## Backend

The backend is a stateless Cloudflare Worker. It has no database and no server process to manage. It verifies Telegram Mini App init data, signs verification attestations, and sends Telegram payment notifications. Nostr relays store and serve all wallet metadata and payment events.

### Endpoints

- `GET /` — health check.
- `GET /config` — returns `{ servicePublicKey, relays }` for clients that are not built with the corresponding environment variables.
- `POST /rpc` — JSON RPC for `bot-info`, `verify-profile`, and `notify-payment`.
- `POST /telegram/webhook` — Telegram bot webhook. Long polling is no longer used.

### Required backend environment

Set secrets and variables with Wrangler (`wrangler secret put ...` for secrets):

- `BOT_TOKEN` — Telegram bot token.
- `NOSTR_PRIVATE_KEY` — service Nostr private key as `nsec` or 32-byte hex. Keep it secret; encrypted metadata is readable by this service key.
- `NOSTR_RELAYS` — comma-separated Nostr relay WebSocket URLs used for event publication and lookup.
- `BOT_USERNAME` — optional bot username, avoids a `getMe` call.
- `TELEGRAM_WEBHOOK_SECRET` — optional secret checked against `X-Telegram-Bot-Api-Secret-Token`.
- `ENVIRONMENT` — set to `development` only for local development.
- `ALLOW_UNVERIFIED_TELEGRAM_DEV=true` — optional development-only bypass. Requires `ENVIRONMENT=development`.

`backend/wrangler.toml` contains non-secret defaults for `NOSTR_RELAYS` and `ENVIRONMENT`. Use `backend/.dev.vars` for local secrets; `.dev.vars.example` is a template.

### Build and deploy

```sh
cd backend
npm install
npm run typecheck
npm run dev      # local Worker on http://localhost:3000
npm run deploy   # deploy to Cloudflare Workers
```

After deploying, register the Telegram webhook:

```sh
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://<worker-host>/telegram/webhook","secret_token":"<TELEGRAM_WEBHOOK_SECRET>"}'
```

The backend does not independently verify on-chain or Breez settlement. Payment records are client reports published after SDK completion.

## Mini app

Set these build-time variables (for example in `mini-app/.env`):

- `VITE_BACKEND_ENDPOINT` — deployed Worker URL.
- `VITE_BREEZ_API_KEY` — Breez SDK API key.
- `VITE_NOSTR_RELAYS` — optional comma-separated relay URLs. Falls back to `GET /config`, then public defaults.
- `VITE_NOSTR_SERVICE_PUBKEY` — optional service Nostr public key. Falls back to `GET /config`.
- `VITE_WEBAUTHN_RP_ID` — optional WebAuthn relying party ID. Defaults to the current hostname.
- `VITE_WEBAUTHN_RP_NAME` — optional WebAuthn relying party name. Defaults to `Brio Wallet`.
- `VITE_WEBAUTHN_PRF_SALT` — optional PRF salt. Defaults to a Brio-specific value.
- `VITE_TELEGRAM_BOT_USERNAME` — optional bot username, avoids the `bot-info` RPC.
- `VITE_COINGECKO_DEMO_API_KEY` — optional CoinGecko price API key.

Build and run from HTTPS so WebAuthn is available:

```sh
cd mini-app
npm install
npm run dev:https
npm run build
```

If wallet creation fails with "The operation either timed out or was not allowed", the browser rejected the WebAuthn request. Use HTTPS (`npm run dev:https`), open the app in Safari or Chrome rather than an embedded preview/webview, keep the window focused, and make sure the device has a platform authenticator (Touch ID, Windows Hello, or a security key). Passkeys also do not work on IP-address origins such as `http://127.0.0.1`; use `http://localhost`.

Resetting a wallet keeps an encrypted copy of the vault on the device. After a reset, **Recover with passkey** on the onboarding screen unlocks that copy with the same passkey, so the recovery phrase is not needed. **Delete wallet permanently** in Settings removes the encrypted backup as well. If the encrypted vault has already been deleted, the passkey alone cannot recreate the wallet; use the recovery phrase instead.

Contacts and the display currency are kept in session storage only. They are never uploaded to Telegram or the backend.

If onboarding fails with "No Nostr relay accepted the event", the relays are unreachable or rejected the write from your network. The error lists each relay's result. Set `VITE_NOSTR_RELAYS` and the backend `NOSTR_RELAYS` to relays reachable from your network; keep both lists aligned so profiles and verification attestations are published and queried on the same relays. The defaults are `relay.primal.net`, `relay.snort.social`, `relay.nostr.net`, `nostr.bitcoiner.social`, and `relay.nostrcheck.me`.

The client publishes profile and payment events directly to Nostr relays; the backend is only involved in verification attestations and Telegram notifications.
