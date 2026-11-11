import { useEffect, useRef } from 'react'
import { hapticFeedback, mainButton } from '@telegram-apps/sdk-react'

type ImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'

/**
 * Small wrappers around Telegram haptics. Every call is guarded so the app keeps
 * working in a normal browser and in older Telegram clients.
 */
export const haptics = {
  impact(style: ImpactStyle = 'light') {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred(style)
    }
  },
  success() {
    if (hapticFeedback.notificationOccurred.isAvailable()) {
      hapticFeedback.notificationOccurred('success')
    }
  },
  error() {
    if (hapticFeedback.notificationOccurred.isAvailable()) {
      hapticFeedback.notificationOccurred('error')
    }
  },
  selection() {
    if (hapticFeedback.selectionChanged.isAvailable()) {
      hapticFeedback.selectionChanged()
    }
  }
}

type MainButtonOptions = {
  text: string
  onClick: () => void
  visible?: boolean
  enabled?: boolean
  loading?: boolean
}

/**
 * Keeps the Telegram Main Button in sync with a page. The click handler is kept
 * in a ref so the button always calls the latest closure.
 */
export function useMainButton({
  text,
  onClick,
  visible = true,
  enabled = true,
  loading = false
}: MainButtonOptions) {
  const handler = useRef(onClick)
  handler.current = onClick

  useEffect(() => {
    if (!mainButton.setParams.isAvailable()) return
    mainButton.setParams({
      text,
      isVisible: visible,
      isEnabled: enabled,
      isLoaderVisible: loading
    })
  }, [text, visible, enabled, loading])

  useEffect(() => {
    if (!mainButton.onClick.isAvailable()) return
    const off = mainButton.onClick(() => handler.current())
    return () => {
      off()
      if (mainButton.setParams.isAvailable()) {
        mainButton.setParams({ isVisible: false, isLoaderVisible: false })
      }
    }
  }, [])
}

/** True when Telegram renders a native Main Button for this client. */
export const hasMainButton = () =>
  !import.meta.env.DEV && mainButton.setParams.isAvailable()
