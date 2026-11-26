import type { Env } from '../env.js'
import { getBotInfo, sendTelegramMessage } from '../bot/index.js'
import {
  WALLET_KEY_PREFIX,
  readWalletRegistry,
  writeWalletRegistry
} from './common.js'

const MEMPOOL_API = 'https://mempool.space/api'

// Budget per cron run. KV reads/writes do not count against the worker
// subrequest limit, but the mempool.space fetches do.
const MAX_WALLETS_PER_RUN = 30

type MempoolTx = {
  txid?: string
  vout?: Array<{ scriptpubkey_address?: string; value?: number }>
}

const satsToAddress = (tx: MempoolTx, btcAddress: string) =>
  (tx.vout ?? [])
    .filter(output => output.scriptpubkey_address === btcAddress)
    .reduce((sum, output) => sum + (output.value ?? 0), 0)

export const handleScheduled = async (env: Env): Promise<void> => {
  if (!env.BRIO_KV) return

  // Rotate through the registry across runs so every watched wallet gets
  // polled even when the list is longer than one page.
  const cursor = await env.BRIO_KV.get('cron:l1-cursor')
  const page = await env.BRIO_KV.list({
    prefix: WALLET_KEY_PREFIX,
    cursor: cursor ?? undefined,
    limit: MAX_WALLETS_PER_RUN
  })

  let bot: { username: string } | null = null
  for (const key of page.keys) {
    const nostrPublicKey = key.name.slice(WALLET_KEY_PREFIX.length)
    const registry = await readWalletRegistry(env, nostrPublicKey)
    const btcAddress = registry?.btcAddress
    if (!registry || !btcAddress) continue

    try {
      const response = await fetch(`${MEMPOOL_API}/address/${btcAddress}/txs`)
      if (!response.ok) continue
      const txs = await response.json() as MempoolTx[]

      const recent = new Set(registry.recentTxids ?? [])
      const fresh = txs.filter(tx =>
        !!tx.txid && !recent.has(tx.txid) && satsToAddress(tx, btcAddress) > 0
      )
      const freshTxids = txs.map(tx => tx.txid).filter((id): id is string => !!id)

      if (fresh.length) {
        bot ??= await getBotInfo(env)
        const miniAppUrl = `https://t.me/${bot.username}?startapp=wallet`
        for (const tx of fresh) {
          const amountSats = satsToAddress(tx, btcAddress)
          const confirmed = (tx as { status?: { confirmed?: boolean } }).status?.confirmed
          const title = confirmed ? '₿ On-chain Bitcoin deposit received' : '₿ Incoming on-chain Bitcoin transaction'
          await sendTelegramMessage(env, registry.chatId, [
            title,
            `Amount: ${amountSats.toLocaleString('en-US')} sats`,
            `Address: ${btcAddress}`,
            `Tx: https://mempool.space/tx/${tx.txid}`
          ].join('\n'), {
            inline_keyboard: [[{ text: 'Open Brio', url: miniAppUrl }]]
          })
        }
      }

      const nextRecent = freshTxids.slice(0, 25)
      const unchanged = nextRecent.length === (registry.recentTxids?.length ?? 0)
        && nextRecent.every((id, index) => id === registry.recentTxids?.[index])
      if (!unchanged) {
        await writeWalletRegistry(env, { ...registry, recentTxids: nextRecent, updatedAt: Math.floor(Date.now() / 1000) }, nostrPublicKey)
      }
    } catch (error) {
      console.warn(`L1 poll failed for ${nostrPublicKey.slice(0, 8)}…:`, error)
    }
  }

  if (!page.list_complete) {
    await env.BRIO_KV.put('cron:l1-cursor', page.cursor ?? '')
  } else if (cursor) {
    // Wrapped around; clear the cursor so the next run starts from the top.
    await env.BRIO_KV.delete('cron:l1-cursor')
  }
}
