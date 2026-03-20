import { createLogger } from '@/core/logging'
import { useEffect, useRef, useState } from 'react'
import { API_KEY_PROVIDERS, type ApiKeyProvider } from '@/core/config/providers'
import {
  aiGetProviderApiKey,
  aiGetProviderKeyStatus,
  aiRemoveProviderApiKey,
  aiSetProviderApiKey,
} from '@/commands/aiRuntime'
import { useSettingsStore } from '@/stores/settingsStore'

const logger = createLogger('components.Settings.hooks.useApiKeys')

type ApiKeys = Record<ApiKeyProvider, string>
type ApiKeyVisibility = Record<ApiKeyProvider, boolean>

export interface UseApiKeysResult {
  keys: ApiKeys
  visibility: ApiKeyVisibility
  updateKey: (provider: ApiKeyProvider, value: string) => void
  toggleVisibility: (provider: ApiKeyProvider) => void
}

const WRITE_DEBOUNCE_MS = 450

const createEmptyKeys = (): ApiKeys => {
  return API_KEY_PROVIDERS.reduce((acc, provider) => {
    acc[provider.id] = ''
    return acc
  }, {} as ApiKeys)
}

const createVisibilityState = (): ApiKeyVisibility => {
  return API_KEY_PROVIDERS.reduce((acc, provider) => {
    acc[provider.id] = false
    return acc
  }, {} as ApiKeyVisibility)
}

export function useApiKeys(): UseApiKeysResult {
  const [keys, setKeys] = useState<ApiKeys>(createEmptyKeys())
  const [visibility, setVisibility] = useState<ApiKeyVisibility>(createVisibilityState())
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout> | undefined>>({})
  const setProviderKeyStatuses = useSettingsStore((state) => state.setProviderKeyStatuses)
  const setProviderKeyStatus = useSettingsStore((state) => state.setProviderKeyStatus)

  useEffect(() => {
    let disposed = false

    const bootstrap = async (): Promise<void> => {
      try {
        const statusList = await aiGetProviderKeyStatus()
        if (disposed) return

        const loadedKeys = createEmptyKeys()
        const statusMap: Record<string, boolean> = {}
        const configuredProviders: ApiKeyProvider[] = []

        statusList.forEach((item) => {
          statusMap[item.providerId] = item.configured
          if (item.configured && item.providerId in loadedKeys) {
            configuredProviders.push(item.providerId as ApiKeyProvider)
          }
        })

        const loadedValues = await Promise.all(
          configuredProviders.map(async (providerId) => {
            try {
              const apiKey = await aiGetProviderApiKey(providerId)
              return [providerId, apiKey ?? ''] as const
            } catch (error) {
              logger.error(`[useApiKeys] load key failed: ${providerId}`, error)
              return [providerId, ''] as const
            }
          })
        )

        if (disposed) return

        loadedValues.forEach(([providerId, apiKey]) => {
          loadedKeys[providerId] = apiKey
        })

        setProviderKeyStatuses(statusMap)
        setKeys(loadedKeys)
      } catch (error) {
        logger.error('[useApiKeys] load key status failed', error)
      }
    }

    void bootstrap()

    return () => {
      disposed = true
      Object.values(timersRef.current).forEach((timer) => {
        if (timer) clearTimeout(timer)
      })
    }
  }, [setProviderKeyStatuses])

  const updateKey = (provider: ApiKeyProvider, value: string) => {
    setKeys((prev) => ({ ...prev, [provider]: value }))

    const existingTimer = timersRef.current[provider]
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    timersRef.current[provider] = setTimeout(() => {
      void (async () => {
        try {
          const trimmed = value.trim()
          if (!trimmed) {
            await aiRemoveProviderApiKey(provider)
            setProviderKeyStatus(provider, false)
            return
          }

          await aiSetProviderApiKey(provider, trimmed)
          setProviderKeyStatus(provider, true)
        } catch (error) {
          logger.error(`[useApiKeys] update key failed: ${provider}`, error)
        }
      })()
    }, WRITE_DEBOUNCE_MS)
  }

  const toggleVisibility = (provider: ApiKeyProvider) => {
    setVisibility((prev) => ({ ...prev, [provider]: !prev[provider] }))
  }

  return { keys, visibility, updateKey, toggleVisibility }
}

